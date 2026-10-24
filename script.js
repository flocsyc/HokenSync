(function() {
	//#region src/storage.ts
	var STORAGE_KEY = "hokensync.customLyrics.v2";
	var DRAFT_STORAGE_KEY = "hokensync.drafts.v1";
	function normalize$4(value) {
		return String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	}
	function makeLyricsKey(artist, title) {
		return `${normalize$4(artist)}|${normalize$4(title)}`;
	}
	function readStorage(key, fallback) {
		try {
			const raw = localStorage.getItem(key);
			return raw ? JSON.parse(raw) : fallback;
		} catch {
			return fallback;
		}
	}
	function writeStorage(key, value) {
		try {
			localStorage.setItem(key, JSON.stringify(value));
		} catch (error) {
			console.error("[HokenSync] Не удалось сохранить данные в localStorage:", error);
		}
	}
	function loadLyricsDatabase() {
		return readStorage(STORAGE_KEY, {});
	}
	function saveLyricsDatabase(database) {
		writeStorage(STORAGE_KEY, database);
	}
	function getSavedLyrics(title, artist) {
		if (!title) return null;
		const saved = loadLyricsDatabase()[makeLyricsKey(artist ?? "", title)];
		return saved && saved.lrc ? saved : null;
	}
	function getAllSavedLyrics() {
		return Object.values(loadLyricsDatabase()).filter((lyrics) => Boolean(lyrics?.lrc?.trim())).sort((a, b) => b.savedAt - a.savedAt);
	}
	function saveLyrics(lyrics) {
		const database = loadLyricsDatabase();
		const key = makeLyricsKey(lyrics.artist, lyrics.title);
		database[key] = {
			...lyrics,
			fromFound: lyrics.fromFound ?? database[key]?.fromFound,
			trackId: lyrics.trackId ?? database[key]?.trackId
		};
		saveLyricsDatabase(database);
	}
	function deleteLyrics(artist, title) {
		const database = loadLyricsDatabase();
		delete database[makeLyricsKey(artist, title)];
		saveLyricsDatabase(database);
	}
	function loadDraft(artist, title) {
		return readStorage(DRAFT_STORAGE_KEY, {})[makeLyricsKey(artist, title)] ?? null;
	}
	function saveDraft(draft) {
		const database = readStorage(DRAFT_STORAGE_KEY, {});
		database[makeLyricsKey(draft.artist, draft.title)] = draft;
		writeStorage(DRAFT_STORAGE_KEY, database);
	}
	function deleteDraft(artist, title) {
		const database = readStorage(DRAFT_STORAGE_KEY, {});
		delete database[makeLyricsKey(artist, title)];
		writeStorage(DRAFT_STORAGE_KEY, database);
	}
	var TEXT_DRAFT_KEY = "hokensync.textDraft.v1";
	function readTextDrafts() {
		try {
			const raw = sessionStorage.getItem(TEXT_DRAFT_KEY);
			return raw ? JSON.parse(raw) : {};
		} catch {
			return {};
		}
	}
	function writeTextDrafts(database) {
		try {
			sessionStorage.setItem(TEXT_DRAFT_KEY, JSON.stringify(database));
		} catch (error) {
			console.warn("[HokenSync] Не удалось сохранить набранный текст:", error);
		}
	}
	function loadTextDraft(artist, title) {
		return readTextDrafts()[makeLyricsKey(artist, title)] ?? "";
	}
	function saveTextDraft(artist, title, text) {
		const database = readTextDrafts();
		const key = makeLyricsKey(artist, title);
		if (text.trim()) database[key] = text;
		else delete database[key];
		writeTextDrafts(database);
	}
	function clearTextDraft(artist, title) {
		saveTextDraft(artist, title, "");
	}
	var DISABLED_KEY = "hokensync.disabledLyrics.v1";
	function readDisabled() {
		return readStorage(DISABLED_KEY, {});
	}
	function isCustomLyricsDisabled(artist, title) {
		return Boolean(readDisabled()[makeLyricsKey(artist, title)]);
	}
	function setCustomLyricsDisabled(artist, title, disabled) {
		const database = readDisabled();
		const key = makeLyricsKey(artist, title);
		if (disabled) database[key] = true;
		else delete database[key];
		writeStorage(DISABLED_KEY, database);
	}
	function getActiveSavedLyrics(title, artist) {
		const saved = getSavedLyrics(title, artist);
		if (!saved) return null;
		return isCustomLyricsDisabled(saved.artist, saved.title) ? null : saved;
	}
	function loadDisabledMap() {
		return readDisabled();
	}
	function saveDisabledMap(map) {
		writeStorage(DISABLED_KEY, map);
	}
	//#endregion
	//#region src/pulsesync.ts
	function hasNativeLyricsInMeta(meta) {
		if (!meta || typeof meta !== "object") return false;
		const record = meta;
		return Boolean(record.isSyncLyricsAvailable || record.isSyncLyricsAvailableWithOfflineFeature || record.hasSyncLyrics || record.lyricsAvailable);
	}
	function normalizeCoverUrl(value) {
		if (typeof value !== "string") return;
		let url = value.trim();
		if (!url) return;
		if (url.startsWith("//")) url = `https:${url}`;
		else if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, "")}`;
		url = url.replace(/%%/g, "300x300");
		return url;
	}
	function getCoverUrl(track, queueMeta) {
		const rawTrack = track && typeof track === "object" ? track : {};
		const rawQueueMeta = queueMeta && typeof queueMeta === "object" ? queueMeta : {};
		const trackAlbum = rawTrack.album && typeof rawTrack.album === "object" ? rawTrack.album : null;
		const metaAlbum = rawQueueMeta.album && typeof rawQueueMeta.album === "object" ? rawQueueMeta.album : null;
		const candidates = [
			rawTrack.coverUrl,
			rawTrack.coverUri,
			rawTrack.cover,
			trackAlbum?.coverUrl,
			trackAlbum?.coverUri,
			trackAlbum?.cover,
			rawQueueMeta.coverUrl,
			rawQueueMeta.coverUri,
			rawQueueMeta.cover,
			metaAlbum?.coverUrl,
			metaAlbum?.coverUri,
			metaAlbum?.cover
		];
		for (const candidate of candidates) {
			const url = normalizeCoverUrl(candidate);
			if (url) return url;
		}
	}
	function getCurrentTrack() {
		try {
			const track = window.pulsesyncApi?.getCurrentTrack?.();
			if (!track) return null;
			const artist = track.artists?.[0]?.name ?? "";
			const duration = typeof track.durationMs === "number" ? track.durationMs / 1e3 : typeof track.duration === "number" ? track.duration : void 0;
			const rawTrack = track;
			const queueEntity = window.sonataState?.queueState?.currentEntity?.value;
			const queueMeta = queueEntity?.entity?.data?.meta ?? queueEntity?.entity?.entityData?.meta;
			const coverUrl = getCoverUrl(rawTrack, queueMeta);
			const hasNativeSyncLyrics = hasNativeLyricsInMeta(rawTrack) || hasNativeLyricsInMeta(queueMeta);
			const lyricsAvailable = Boolean(rawTrack.lyricsAvailable || hasNativeSyncLyrics || queueMeta && typeof queueMeta === "object" && (queueMeta.lyricsAvailable || hasNativeLyricsInMeta(queueMeta)));
			const album = track.albums?.[0];
			const albumName = String(album?.title ?? album?.name ?? "").trim();
			return {
				id: String(track.id),
				title: track.title ?? "",
				artist,
				duration,
				coverUrl,
				albumName: albumName || void 0,
				hasNativeSyncLyrics,
				lyricsAvailable
			};
		} catch (error) {
			console.error("[HokenSync] Failed to get current track:", error);
			return null;
		}
	}
	function getProgressSeconds() {
		try {
			const progress = window.pulsesyncApi?.getProgress?.();
			if (typeof progress === "number") return progress;
			if (progress && typeof progress === "object" && typeof progress.position === "number") return progress.position;
			return null;
		} catch {
			return null;
		}
	}
	function setProgress(seconds) {
		window.pulsesyncApi?.setProgress?.(Math.max(0, seconds));
	}
	function play() {
		window.pulsesyncApi?.play?.();
	}
	function pause() {
		window.pulsesyncApi?.pause?.();
	}
	function togglePlayPause() {
		window.pulsesyncApi?.togglePlayPause?.();
	}
	function isPlaying() {
		try {
			const progress = window.pulsesyncApi?.getProgress?.();
			if (progress && typeof progress === "object" && typeof progress.isPlaying === "boolean") return Boolean(progress.isPlaying);
			const result = window.pulsesyncApi?.isPlaying?.();
			return typeof result === "boolean" ? result : false;
		} catch {
			return false;
		}
	}
	function getRepeatMode() {
		try {
			return window.pulsesyncApi?.getRepeatMode?.();
		} catch {
			return;
		}
	}
	function setRepeatMode(mode) {
		try {
			window.pulsesyncApi?.setRepeatMode?.(mode);
		} catch (error) {
			console.warn("[HokenSync] Не удалось изменить режим повтора:", error);
		}
	}
	function playTrackById(trackId) {
		const api = window.pulsesyncApi;
		if (typeof api?.playTrackById !== "function") return false;
		try {
			Promise.resolve(api.playTrackById(trackId)).catch((error) => {
				console.warn("[HokenSync] Плеер не смог включить песню:", error);
			});
			return true;
		} catch (error) {
			console.warn("[HokenSync] Плеер не смог включить песню:", error);
			return false;
		}
	}
	//#endregion
	//#region src/lyrics-source.ts
	var OBSERVED_TTL_MS = 3600 * 1e3;
	var nativeTracks = /* @__PURE__ */ new Map();
	var lrclibItems = [];
	function normalizeTitle$2(value) {
		return String(value ?? "").toLowerCase().replace(/\[[^\]]*]\s*/g, "").replace(/\([^)]*?(paused|cover|remix|live|legacy|acoustic|radio\s*edit|extended|version|edit)[^)]*\)/gi, "").replace(/\b(paused|cover|remix|live|legacy|acoustic|radio\s*edit|extended|version|edit)\b/gi, "").replace(/[^\p{L}\p{N}]+/gu, "").trim();
	}
	function normalizeArtist(value) {
		return String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
	}
	function isRecent(timestamp) {
		return Date.now() - timestamp <= OBSERVED_TTL_MS;
	}
	function markNativeLyrics(trackId) {
		nativeTracks.set(String(trackId), Date.now());
	}
	function markLrclibItem(requestedTitle, requestedArtist, item) {
		const title = String(item.trackName ?? item.track_name ?? item.title ?? item.name ?? requestedTitle ?? "").trim();
		const artist = String(item.artistName ?? item.artist_name ?? requestedArtist ?? "").trim();
		if (!title) return;
		const hasSyncedLyrics = typeof item.syncedLyrics === "string" && item.syncedLyrics.trim().length > 0;
		const hasPlainLyrics = typeof item.plainLyrics === "string" && item.plainLyrics.trim().length > 0;
		if (!hasSyncedLyrics && !hasPlainLyrics) return;
		const normalizeRequestedTitle = requestedTitle ? normalizeTitle$2(requestedTitle) : "";
		const normalizeItemTitle = normalizeTitle$2(title);
		if (normalizeRequestedTitle && normalizeItemTitle !== normalizeRequestedTitle) return;
		const requestedArtistNormalized = normalizeArtist(requestedArtist);
		const itemArtistNormalized = normalizeArtist(artist);
		if (requestedArtistNormalized && itemArtistNormalized && requestedArtistNormalized !== itemArtistNormalized) return;
		const duration = typeof item.duration === "number" && Number.isFinite(item.duration) ? item.duration : void 0;
		const entry = {
			title,
			artist,
			duration,
			synced: hasSyncedLyrics,
			plain: hasPlainLyrics,
			updatedAt: Date.now()
		};
		const key = `${normalizeArtist(artist)}|${normalizeTitle$2(title)}|${duration ?? ""}`;
		const existingIndex = lrclibItems.findIndex((candidate) => `${normalizeArtist(candidate.artist)}|${normalizeTitle$2(candidate.title)}|${candidate.duration ?? ""}` === key);
		if (existingIndex >= 0) lrclibItems[existingIndex] = entry;
		else lrclibItems.push(entry);
		while (lrclibItems.length > 500) lrclibItems.shift();
	}
	function hasRecentNativeLyrics(track) {
		const timestamp = nativeTracks.get(String(track.id));
		if (!timestamp) return false;
		if (!isRecent(timestamp)) {
			nativeTracks.delete(String(track.id));
			return false;
		}
		return true;
	}
	function hasMatchingLrclibLyrics(track) {
		const wantedArtist = normalizeArtist(track.artist);
		const wantedTitle = normalizeTitle$2(track.title);
		return lrclibItems.some((item) => {
			if (!isRecent(item.updatedAt)) return false;
			if (!item.synced && !item.plain) return false;
			const itemArtist = normalizeArtist(item.artist);
			if (wantedArtist && itemArtist && !itemArtist.includes(wantedArtist) && !wantedArtist.includes(itemArtist)) return false;
			const itemTitle = normalizeTitle$2(item.title);
			if (!itemTitle || itemTitle !== wantedTitle) return false;
			if (typeof track.duration === "number" && track.duration > 0 && typeof item.duration === "number" && item.duration > 0 && Math.abs(item.duration - track.duration) > 10) return false;
			return true;
		});
	}
	function getLyricsSource(track) {
		if (hasRecentNativeLyrics(track)) return "native";
		if (hasMatchingLrclibLyrics(track)) return "lrclib";
		return "none";
	}
	//#endregion
	//#region src/lyrics-cache.ts
	var DB_NAME = "hokensync-lyrics-cache";
	var DB_VERSION = 1;
	var STORE_NAME = "lyrics";
	var NOT_FOUND_TTL_MS = 10080 * 60 * 1e3;
	var dbPromise = null;
	function normalize$3(value) {
		return String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	}
	function makeLyricsCacheKey(title, artist) {
		return `${normalize$3(artist)}|${normalize$3(title)}`;
	}
	function makeLyricsNotFoundKey(title, artist) {
		return `not-found|${makeLyricsCacheKey(title, artist)}`;
	}
	function openDatabase() {
		if (dbPromise) return dbPromise;
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => {
				dbPromise = null;
				reject(request.error);
			};
			request.onblocked = () => {
				console.warn("[HokenSync] IndexedDB открытие заблокировано");
			};
		});
		return dbPromise;
	}
	async function saveCachedLyrics(entry) {
		if (!entry.plainLyrics && !entry.syncedLyrics) return;
		const db = await openDatabase();
		const value = {
			...entry,
			key: makeLyricsCacheKey(entry.title, entry.artist),
			source: "lrclib",
			savedAt: entry.savedAt ?? Date.now()
		};
		await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			store.put(value);
			store.delete(makeLyricsNotFoundKey(entry.title, entry.artist));
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
	async function getCachedLyrics(title, artist) {
		const db = await openDatabase();
		const key = makeLyricsCacheKey(title, artist);
		return new Promise((resolve, reject) => {
			const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
			request.onsuccess = () => {
				const value = request.result;
				if (!value || value.source !== "lrclib") {
					resolve(null);
					return;
				}
				resolve(value);
			};
			request.onerror = () => reject(request.error);
		});
	}
	async function getEditedCachedLyrics() {
		const db = await openDatabase();
		return new Promise((resolve, reject) => {
			const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
			request.onsuccess = () => {
				resolve((request.result ?? []).filter((record) => record.source === "lrclib" && record.edited === true).filter((record) => Boolean(record.syncedLyrics?.trim())).sort((a, b) => b.savedAt - a.savedAt));
			};
			request.onerror = () => reject(request.error);
		});
	}
	async function attachCoverToEditedLyrics(title, artist, coverUrl) {
		const db = await openDatabase();
		const key = makeLyricsCacheKey(title, artist);
		await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(key);
			request.onsuccess = () => {
				const value = request.result;
				if (value && value.source === "lrclib" && value.edited && !value.coverUrl) store.put({
					...value,
					coverUrl
				});
			};
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
	async function resetEditedLyrics(title, artist) {
		const db = await openDatabase();
		const key = makeLyricsCacheKey(title, artist);
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(key);
			let result = "none";
			request.onsuccess = () => {
				const value = request.result;
				if (!value || value.source !== "lrclib" || !value.edited) return;
				const original = value.original;
				if (original && (original.syncedLyrics || original.plainLyrics)) {
					const restored = {
						key: value.key,
						title: value.title,
						artist: value.artist,
						duration: value.duration,
						plainLyrics: original.plainLyrics,
						syncedLyrics: original.syncedLyrics,
						source: "lrclib",
						savedAt: value.savedAt,
						foundBy: value.foundBy,
						coverUrl: value.coverUrl,
						trackId: value.trackId
					};
					store.put(restored);
					result = "restored";
				} else {
					store.delete(key);
					result = "removed";
				}
			};
			transaction.oncomplete = () => resolve(result);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
	async function deleteCachedLyrics(title, artist) {
		const db = await openDatabase();
		const key = makeLyricsCacheKey(title, artist);
		await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).delete(key);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
	async function attachTrackIdToEditedLyrics(title, artist, trackId) {
		const db = await openDatabase();
		const key = makeLyricsCacheKey(title, artist);
		await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(key);
			request.onsuccess = () => {
				const value = request.result;
				if (value && value.source === "lrclib" && value.edited && !value.trackId) store.put({
					...value,
					trackId
				});
			};
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
	async function markLyricsNotFound(title, artist) {
		const db = await openDatabase();
		const value = {
			key: makeLyricsNotFoundKey(title, artist),
			title,
			artist,
			source: "not-found",
			savedAt: Date.now()
		};
		await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).put(value);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
	async function hasLyricsNotFound(title, artist) {
		const db = await openDatabase();
		const key = makeLyricsNotFoundKey(title, artist);
		return new Promise((resolve, reject) => {
			const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
			request.onsuccess = () => {
				const value = request.result;
				if (!value || value.source !== "not-found") {
					resolve(false);
					return;
				}
				if (Date.now() - value.savedAt > NOT_FOUND_TTL_MS) {
					db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key);
					resolve(false);
					return;
				}
				resolve(true);
			};
			request.onerror = () => reject(request.error);
		});
	}
	async function initLyricsCache() {
		await openDatabase();
	}
	async function clearLyricsCache() {
		const db = await openDatabase();
		await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).clear();
			transaction.oncomplete = () => {
				resolve();
			};
			transaction.onerror = () => {
				reject(transaction.error);
			};
			transaction.onabort = () => {
				reject(transaction.error);
			};
		});
		console.log("[HokenSync] База автоматически сохранённых текстов очищена");
	}
	//#endregion
	//#region src/yandex/react-store.ts
	var cachedRootStore = null;
	var cachedSyncLyricsModel = null;
	function getReactFiber(element) {
		if (!element) return null;
		const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"));
		return fiberKey ? element[fiberKey] : null;
	}
	function isRootStore(value) {
		const store = value;
		return Boolean(store && typeof store === "object" && store.trackLyrics && store.fullscreenPlayer?.syncLyrics && store.sonataState);
	}
	function findRootStore() {
		if (cachedRootStore) return cachedRootStore;
		let fiber = getReactFiber(document.querySelector("#__next")) || getReactFiber(document.body);
		if (!fiber) for (const element of document.querySelectorAll("*")) {
			fiber = getReactFiber(element);
			if (fiber) break;
		}
		if (!fiber) return null;
		while (fiber.return) fiber = fiber.return;
		const seen = /* @__PURE__ */ new Set();
		const stack = [fiber];
		while (stack.length) {
			const current = stack.pop();
			if (!current || seen.has(current)) continue;
			seen.add(current);
			const candidates = [
				current.memoizedProps?.value,
				current.pendingProps?.value,
				current.memoizedProps?.store,
				current.pendingProps?.store
			];
			for (const candidate of candidates) if (isRootStore(candidate)) {
				cachedRootStore = candidate;
				return candidate;
			}
			if (current.child) stack.push(current.child);
			if (current.sibling) stack.push(current.sibling);
		}
		return null;
	}
	function findSyncLyricsModel() {
		if (cachedSyncLyricsModel && typeof cachedSyncLyricsModel.getData === "function") return cachedSyncLyricsModel;
		const syncLyrics = findRootStore()?.fullscreenPlayer?.syncLyrics;
		if (syncLyrics && typeof syncLyrics.getData === "function") {
			cachedSyncLyricsModel = syncLyrics;
			return syncLyrics;
		}
		return null;
	}
	//#endregion
	//#region src/lyrics.ts
	function formatTime(seconds) {
		if (!Number.isFinite(seconds)) return "00:00.00";
		const safe = Math.max(0, seconds);
		const minutes = Math.floor(safe / 60);
		const secs = safe - minutes * 60;
		return `${String(minutes).padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
	}
	function parseLrc(lrc) {
		const result = [];
		for (const rawLine of lrc.split(/\r?\n/)) {
			const match = rawLine.match(/^\[(\d{1,3}):(\d{2}(?:\.\d+)?)\]\s*(.*)$/);
			if (!match) continue;
			const minutes = Number.parseInt(match[1], 10);
			const seconds = Number.parseFloat(match[2]);
			if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
			const text = match[3].trim().replace(/\u200B/g, "").trim();
			result.push({
				text,
				time: minutes * 60 + seconds,
				isBreak: text.length === 0
			});
		}
		return result;
	}
	function lrcToPlainText(lrc) {
		return lrc.split(/\r?\n/).map((line) => line.replace(/^\[\d{1,3}:\d{2}(?:\.\d+)?\]\s*/, "").trim()).filter(Boolean).join("\n");
	}
	function serializeLrc(lines) {
		return lines.filter((line) => line.time !== null).map((line) => line.isBreak || !line.text.trim() ? `[${formatTime(line.time)}] \u200B` : `[${formatTime(line.time)}] ${line.text.trim()}`).join("\n");
	}
	var SECTION_LABEL = /^(?:куплет|припев|предприпев|постприпев|бридж|интерлюдия|интро|аутро|вступление|проигрыш|interlude|verse|chorus|pre-?chorus|post-?chorus|bridge|intro|outro|hook|refrain|instrumental)(?:\s*\d+)?\s*:?$/iu;
	function isSectionLabel(line) {
		const trimmed = line.trim();
		return /^\[[^\]]*\]$/.test(trimmed) || SECTION_LABEL.test(trimmed);
	}
	var SECTION_LABELS = [
		"Интро",
		"Куплет",
		"Предприпев",
		"Припев",
		"Постприпев",
		"Бридж",
		"Интерлюдия",
		"Аутро"
	];
	var LABEL_ALIASES = [
		[/^(?:вступление|интро|intro)(?=\s|\d|$)/iu, "Интро"],
		[/^(?:интерлюдия|interlude)(?=\s|\d|$)/iu, "Интерлюдия"],
		[/^(?:конец|окончание|концовка|аутро|outro)(?=\s|\d|$)/iu, "Аутро"],
		[/^(?:пред\s*-?\s*припев|pre\s*-?\s*chorus)(?=\s|\d|$)/iu, "Предприпев"],
		[/^(?:пост\s*-?\s*припев|post\s*-?\s*chorus)(?=\s|\d|$)/iu, "Постприпев"]
	];
	function labelOf(line) {
		const trimmed = line.trim();
		const bracket = trimmed.match(/^\[([^\]]*)\]$/);
		const base = (bracket ? bracket[1] : trimmed).split(":")[0].replace(/\s{2,}/g, " ").trim();
		for (const [pattern, name] of LABEL_ALIASES) if (pattern.test(base)) return base.replace(pattern, name);
		return base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
	}
	function cleanLyricLine(line) {
		return line.replace(/\[[^\]]*\]/g, "").replace(/\u200B/g, "").replace(/\s{2,}/g, " ").trim().replace(/[\s.,\-–—]+$/u, "").trim();
	}
	function parseLyricsText(text) {
		const lines = [];
		const sections = [];
		for (const raw of text.split(/\r?\n/)) {
			if (isSectionLabel(raw)) {
				const label = labelOf(raw);
				if (label) sections.push({
					before: lines.length,
					label
				});
				continue;
			}
			const line = cleanLyricLine(raw);
			if (line) lines.push(line);
		}
		return {
			lines,
			sections
		};
	}
	function pushLabels(out, sections, index) {
		for (const mark of sections) {
			if (mark.before !== index) continue;
			if (out.length && out[out.length - 1] !== "") out.push("");
			out.push(`[${mark.label}]`);
		}
	}
	function sectionsToText(lines, sections) {
		const out = [];
		lines.forEach((line, index) => {
			pushLabels(out, sections, index);
			out.push(line);
		});
		pushLabels(out, sections, lines.length);
		return out.join("\n");
	}
	function lrcToDisplayText(lrc, sections = []) {
		const out = [];
		let ordinal = 0;
		for (const raw of lrc.split(/\r?\n/)) {
			if (!raw.trim()) continue;
			const body = raw.replace(/^\[\d{1,3}:\d{2}(?:\.\d+)?\]\s*/, "").trim();
			if (!body || body === "​") {
				out.push("");
				continue;
			}
			pushLabels(out, sections, ordinal);
			out.push(body);
			ordinal += 1;
		}
		pushLabels(out, sections, ordinal);
		return out.join("\n").replace(/\n+$/, "");
	}
	function formatLyricsText(text) {
		const result = [];
		for (const raw of text.split(/\r?\n/)) {
			const line = raw.replace(/\u200B/g, "").replace(/\s{2,}/g, " ").trim();
			if (!line) {
				if (result.length && result[result.length - 1] !== "") result.push("");
				continue;
			}
			if (isSectionLabel(line)) {
				const label = labelOf(line);
				if (label) {
					if (result.length && result[result.length - 1] !== "") result.push("");
					result.push(`[${label}]`);
				}
				continue;
			}
			const cleaned = cleanLyricLine(line);
			if (cleaned) result.push(cleaned);
		}
		while (result.length && result[result.length - 1] === "") result.pop();
		return result.join("\n");
	}
	//#endregion
	//#region src/lyrics-search.ts
	var LRCLIB_BASE_URL = "https://lrclib.net/api";
	var REQUEST_TIMEOUT_MS = 8e3;
	var nativeFetch = window.fetch.bind(window);
	var SEARCH_LIMIT_HITS = 3;
	var SEARCH_LIMIT_MS = 60 * 1e3;
	var searchLimitListeners = /* @__PURE__ */ new Set();
	var searchLimitUntil = null;
	var searchLimitHits = 0;
	function reportSearchStatus(status) {
		if (status === 429) {
			searchLimitHits += 1;
			if (searchLimitHits >= SEARCH_LIMIT_HITS) setSearchLimit(Date.now() + SEARCH_LIMIT_MS);
		} else if (status >= 200 && status < 300 || status === 404) {
			searchLimitHits = 0;
			setSearchLimit(null);
		}
	}
	function getSearchLimitUntil() {
		return searchLimitUntil;
	}
	function onSearchLimitChange(listener) {
		searchLimitListeners.add(listener);
		return () => {
			searchLimitListeners.delete(listener);
		};
	}
	function setSearchLimit(until) {
		if (until === null && searchLimitUntil === null) return;
		searchLimitUntil = until;
		for (const listener of searchLimitListeners) try {
			listener(until);
		} catch (error) {
			console.error("[HokenSync] Ошибка в обработчике лимита запросов:", error);
		}
	}
	var TITLE_NOISE = [
		"cover",
		"remix",
		"legacy",
		"live",
		"acoustic",
		"radioedit",
		"extended",
		"version",
		"edit",
		"paused"
	];
	function normalize$2(value) {
		return String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	}
	function normalizeTitle$1(value) {
		let result = String(value ?? "").toLowerCase().replace(/[\[(].*?[\])]/g, " ");
		for (const noise of TITLE_NOISE) result = result.replace(new RegExp(`\\b${noise}\\b`, "gi"), " ");
		return normalize$2(result);
	}
	function cleanTitle(value) {
		return String(value ?? "").replace(/[\[(].*?[\])]/g, " ").replace(/\s+(?:feat\.?|ft\.?|featuring|x|х|×|&|\+|prod\.?|with)\s+.*$/iu, "").replace(/\s{2,}/g, " ").trim();
	}
	function hasLyrics(candidate) {
		return Boolean(!candidate.instrumental && (candidate.syncedLyrics?.trim() || candidate.plainLyrics?.trim()));
	}
	function titleScore(requested, candidate) {
		const exactRequested = normalize$2(requested);
		const exactCandidate = normalize$2(candidate);
		if (!exactRequested || !exactCandidate) return 0;
		if (exactRequested === exactCandidate) return 100;
		const baseRequested = normalizeTitle$1(requested);
		const baseCandidate = normalizeTitle$1(candidate);
		if (baseRequested && baseRequested === baseCandidate) return 85;
		const cleanRequested = normalize$2(cleanTitle(requested));
		if (cleanRequested && cleanRequested === normalize$2(cleanTitle(candidate))) return 75;
		return 0;
	}
	var CYRILLIC_TO_LATIN = {
		а: "a",
		б: "b",
		в: "v",
		г: "g",
		д: "d",
		е: "e",
		ё: "e",
		ж: "zh",
		з: "z",
		и: "i",
		й: "y",
		к: "k",
		л: "l",
		м: "m",
		н: "n",
		о: "o",
		п: "p",
		р: "r",
		с: "s",
		т: "t",
		у: "u",
		ф: "f",
		х: "kh",
		ц: "ts",
		ч: "ch",
		ш: "sh",
		щ: "sch",
		ъ: "",
		ы: "y",
		ь: "",
		э: "e",
		ю: "yu",
		я: "ya"
	};
	function translit(value) {
		return value.replace(/[а-яё]/g, (char) => CYRILLIC_TO_LATIN[char] ?? char);
	}
	function artistScore(requested, candidate) {
		const a = normalize$2(requested);
		const b = normalize$2(candidate);
		if (!a || !b) return 0;
		if (a === b) return 40;
		if (a.includes(b) || b.includes(a)) return 20;
		const ta = translit(a);
		const tb = translit(b);
		if (ta === tb || ta.includes(tb) || tb.includes(ta)) return 30;
		return 0;
	}
	function durationScore(requested, candidate) {
		if (requested === void 0 || candidate === void 0 || !Number.isFinite(requested) || !Number.isFinite(candidate)) return 0;
		const difference = Math.abs(requested - candidate);
		if (difference <= 1) return 35;
		if (difference <= 2) return 25;
		if (difference <= 5) return 10;
		if (difference <= 10) return -10;
		return -30;
	}
	function lyricsScore(candidate) {
		if (candidate.syncedLyrics?.trim()) return 40;
		if (candidate.plainLyrics?.trim()) return 5;
		return 0;
	}
	function scoreCandidate(track, candidate) {
		if (!hasLyrics(candidate)) return Number.NEGATIVE_INFINITY;
		const title = titleScore(track.title, candidate.trackName ?? "");
		if (title === 0) return Number.NEGATIVE_INFINITY;
		const artist = artistScore(track.artist, candidate.artistName ?? "");
		const duration = durationScore(track.duration, candidate.duration);
		if (artist === 0 && duration < 25) return Number.NEGATIVE_INFINITY;
		return title + artist + duration + lyricsScore(candidate);
	}
	function makeUrl(endpoint, params) {
		const url = new URL(`${LRCLIB_BASE_URL}/${endpoint}`);
		for (const [key, value] of Object.entries(params)) if (value !== "") url.searchParams.set(key, value);
		return url.href;
	}
	var REQUEST_GAP_MS = 400;
	var requestQueue = Promise.resolve();
	function fetchJson(url) {
		const run = requestQueue.then(() => fetchJsonNow(url));
		requestQueue = run.catch(() => void 0).then(() => new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS)));
		return run;
	}
	async function fetchJsonNow(url) {
		const startedAt = performance.now();
		console.log("[HokenSync SEARCH] Запрос:", url);
		try {
			const response = await nativeFetch(url, {
				credentials: "omit",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
			});
			console.log("[HokenSync SEARCH] Ответ:", response.status, Math.round(performance.now() - startedAt) + " ms");
			reportSearchStatus(response.status);
			if (response.status === 404) return null;
			if (!response.ok) throw new Error(`LRCLIB ${response.status}`);
			return response.json();
		} catch (error) {
			console.log("[HokenSync SEARCH] Ошибка:", Math.round(performance.now() - startedAt) + " ms", error);
			throw error;
		}
	}
	async function fetchGet(track) {
		const params = {
			track_name: track.title,
			artist_name: track.artist
		};
		if (typeof track.duration === "number" && Number.isFinite(track.duration)) params.duration = String(Math.round(track.duration));
		const data = await fetchJson(makeUrl("get", params));
		if (!data || typeof data !== "object") return [];
		return [data];
	}
	async function fetchSearch(params) {
		const data = await fetchJson(makeUrl("search", params));
		if (!Array.isArray(data)) return [];
		return data.filter((item) => Boolean(item && typeof item === "object"));
	}
	var MIN_CONFIDENT_SCORE = 130;
	function buildAttempts(track) {
		const clean = cleanTitle(track.title);
		const latinArtist = translit(track.artist.toLowerCase());
		return [
			{
				method: "get",
				request: () => fetchGet(track)
			},
			{
				method: "search-artist",
				request: () => fetchSearch({
					track_name: track.title,
					artist_name: track.artist
				})
			},
			...clean && clean !== track.title.trim() ? [{
				method: "search-clean",
				request: () => fetchSearch({
					track_name: clean,
					artist_name: track.artist
				})
			}] : [],
			.../[а-яё]/i.test(track.artist) && latinArtist !== track.artist.toLowerCase() ? [{
				method: "search-translit",
				request: () => fetchSearch({
					track_name: clean || track.title,
					artist_name: latinArtist
				})
			}] : [],
			{
				method: "search-title",
				request: () => fetchSearch({ track_name: track.title })
			}
		];
	}
	async function searchLyrics(track) {
		const attempts = buildAttempts(track);
		let best = null;
		let failed = 0;
		let lastError = null;
		for (const attempt of attempts) try {
			const items = await attempt.request();
			console.log("[HokenSync SEARCH] Кандидатов:", attempt.method, items.length, "подходит:", items.filter((item) => scoreCandidate(track, item) !== Number.NEGATIVE_INFINITY).length);
			for (const candidate of items) {
				const score = scoreCandidate(track, candidate);
				if (score === Number.NEGATIVE_INFINITY) continue;
				const result = {
					candidate,
					score,
					method: attempt.method
				};
				if (!best || score > best.score) best = result;
				if (score >= MIN_CONFIDENT_SCORE && result.candidate.syncedLyrics?.trim()) {
					console.log("[HokenSync] Собственный поиск LRCLIB:", track.artist, "-", track.title, {
						score: result.score,
						method: result.method,
						trackName: result.candidate.trackName,
						artistName: result.candidate.artistName,
						duration: result.candidate.duration,
						hasSyncedLyrics: Boolean(result.candidate.syncedLyrics)
					});
					return result;
				}
			}
		} catch (error) {
			failed += 1;
			lastError = error;
			if (failed >= 2) break;
		}
		if (!best && failed >= 2) throw lastError;
		console.log("[HokenSync] Собственный поиск LRCLIB:", track.artist, "-", track.title, best ? {
			score: best.score,
			method: best.method,
			trackName: best.candidate.trackName,
			artistName: best.candidate.artistName,
			duration: best.candidate.duration,
			hasSyncedLyrics: Boolean(best.candidate.syncedLyrics)
		} : "ничего подходящего");
		return best;
	}
	function countBreaks(synced) {
		const flags = synced.split(/\r?\n/).filter((line) => line.trim()).map((line) => /^\[\d{1,3}:\d{2}(?:\.\d+)?\]\s*\u200B?\s*$/.test(line));
		const total = flags.filter(Boolean).length;
		return flags.length && flags[flags.length - 1] ? total - 1 : total;
	}
	function toVariant(track, candidate, score, method) {
		const synced = candidate.syncedLyrics?.trim() ?? "";
		const title = titleScore(track.title, candidate.trackName ?? "");
		const artist = artistScore(track.artist, candidate.artistName ?? "");
		const duration = durationScore(track.duration, candidate.duration);
		return {
			candidate,
			score,
			method,
			synced: Boolean(synced),
			breaks: countBreaks(synced),
			confident: Boolean(synced) && title >= 85 && artist >= 30 && duration >= 25
		};
	}
	function variantKey(candidate) {
		return candidate.id !== void 0 ? `id:${candidate.id}` : `${normalize$2(candidate.artistName)}|${normalize$2(candidate.trackName)}|${candidate.duration ?? ""}`;
	}
	function sortVariants(items) {
		const rank = (item) => item.score + (item.breaks > 0 ? 3 : 0);
		return items.sort((a, b) => Number(b.synced) - Number(a.synced) || rank(b) - rank(a));
	}
	async function searchLyricsAll(track, stopAtConfident = false) {
		const variants = /* @__PURE__ */ new Map();
		let failed = 0;
		let lastError = null;
		for (const attempt of buildAttempts(track)) try {
			const items = await attempt.request();
			for (const candidate of items) {
				const score = scoreCandidate(track, candidate);
				if (score === Number.NEGATIVE_INFINITY) continue;
				const key = variantKey(candidate);
				const existing = variants.get(key);
				if (!existing || score > existing.score) variants.set(key, toVariant(track, candidate, score, attempt.method));
			}
			console.log("[HokenSync SEARCH] Варианты:", attempt.method, items.length, "всего подходит:", variants.size);
			if (stopAtConfident && [...variants.values()].some((variant) => variant.confident)) break;
		} catch (error) {
			failed += 1;
			lastError = error;
			if (failed >= 2) break;
		}
		if (!variants.size && failed >= 2) throw lastError;
		return sortVariants([...variants.values()]);
	}
	//#endregion
	//#region src/lyrics-find.ts
	var VARIANTS_TTL_MS = 3600 * 1e3;
	var EMPTY_TTL_MS = 600 * 1e3;
	var VARIANTS_LIMIT = 100;
	var variantsCache = /* @__PURE__ */ new Map();
	var variantsInFlight = /* @__PURE__ */ new Map();
	function normalizeKeyPart(value) {
		return String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	}
	function variantsKey(track) {
		return `${normalizeKeyPart(track.artist)}|${normalizeKeyPart(track.title)}`;
	}
	function toFoundVariant(variant) {
		const candidate = variant.candidate;
		const synced = candidate.syncedLyrics?.trim() ?? "";
		return {
			plain: candidate.plainLyrics?.trim() || (synced ? lrcToPlainText(synced) : ""),
			synced,
			trackName: candidate.trackName?.trim() ?? "",
			artistName: candidate.artistName?.trim() ?? "",
			duration: typeof candidate.duration === "number" ? candidate.duration : void 0,
			breaks: variant.breaks,
			score: variant.score,
			confident: variant.confident
		};
	}
	function getCachedVariants(track) {
		const key = variantsKey(track);
		const entry = variantsCache.get(key);
		if (!entry) return null;
		if (Date.now() - entry.at > entry.ttl) {
			variantsCache.delete(key);
			return null;
		}
		return entry.items;
	}
	async function findLyricsVariants(track, force = false, stopAtConfident = false) {
		const key = variantsKey(track);
		if (!force) {
			const cached = getCachedVariants(track);
			if (cached) return cached;
			const running = variantsInFlight.get(key);
			if (running) return running;
		}
		const request = searchLyricsAll(track, stopAtConfident).then((variants) => {
			const items = variants.map(toFoundVariant);
			if (!(stopAtConfident && items.some((item) => item.confident))) variantsCache.set(key, {
				at: Date.now(),
				ttl: items.length ? VARIANTS_TTL_MS : EMPTY_TTL_MS,
				items
			});
			while (variantsCache.size > VARIANTS_LIMIT) {
				const oldest = variantsCache.keys().next().value;
				if (oldest === void 0) break;
				variantsCache.delete(oldest);
			}
			return items;
		}).finally(() => {
			variantsInFlight.delete(key);
		});
		variantsInFlight.set(key, request);
		return request;
	}
	//#endregion
	//#region src/yandex/lyrics-model.ts
	var HOKEN_EXTERNAL_PREFIX = "hokensync";
	var CACHE_EXTERNAL_PREFIX = "hokensync-cache";
	var cachedSyncLyrics = /* @__PURE__ */ new Map();
	var observedLyricsLoading = /* @__PURE__ */ new Set();
	var observedLyricsSearchFinished = /* @__PURE__ */ new Set();
	function isCurrentTrackLyricsLoading() {
		const track = getCurrentTrack();
		if (!track?.id) return false;
		const syncLyrics = findSyncLyricsModel();
		if (!syncLyrics) return false;
		const modelTrackId = syncLyrics.currentTrackId ?? syncLyrics.trackId;
		if (modelTrackId !== null && modelTrackId !== void 0 && String(modelTrackId) !== String(track.id)) return false;
		if (typeof syncLyrics.externalLyricId === "string" && syncLyrics.externalLyricId.startsWith(HOKEN_EXTERNAL_PREFIX)) return false;
		const loadingState = syncLyrics.loadingState;
		return loadingState === "PENDING" || loadingState === "LOADING";
	}
	function applySavedLyricsToSyncModel(syncLyrics, saved, trackId, externalIdPrefix = HOKEN_EXTERNAL_PREFIX) {
		if (!syncLyrics?.$treenode?._applySnapshot || typeof syncLyrics.toJSON !== "function") return false;
		const parsedLines = saved.lrc.split(/\r?\n/).map((line) => {
			const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/);
			if (!match) return null;
			const minutes = Number(match[1]);
			const seconds = Number(match[2]);
			return {
				text: match[3] ?? "",
				time: minutes * 60 + seconds
			};
		}).filter((line) => line !== null);
		if (!parsedLines.length) return false;
		const duration = typeof saved.duration === "number" && Number.isFinite(saved.duration) && saved.duration > 0 ? saved.duration : 999999;
		const snapshot = JSON.parse(JSON.stringify(syncLyrics.toJSON()));
		snapshot.currentTrackId = String(trackId);
		snapshot.lines = parsedLines.map((line, index) => ({
			text: line.text,
			fromSec: line.time,
			toSec: parsedLines[index + 1]?.time ?? duration
		}));
		snapshot.loadingState = "RESOLVE";
		snapshot.isVisible = false;
		snapshot.hasLyricsViewed = true;
		snapshot.lyricId = null;
		snapshot.externalLyricId = `${externalIdPrefix}:${trackId}:${saved.savedAt}`;
		try {
			syncLyrics.$treenode._applySnapshot(snapshot);
			console.log("[HokenSync] Собственный текст установлен в syncLyrics:", saved.artist, "-", saved.title);
			return true;
		} catch (error) {
			console.error("[HokenSync] Не удалось установить собственный текст:", error);
			return false;
		}
	}
	function applyCachedLyricsToSyncModel(syncLyrics, cached, trackId) {
		if (!cached.syncedLyrics?.trim()) return false;
		const applied = applySavedLyricsToSyncModel(syncLyrics, {
			title: cached.title,
			artist: cached.artist,
			duration: cached.duration,
			lrc: cached.syncedLyrics,
			savedAt: cached.savedAt
		}, trackId, CACHE_EXTERNAL_PREFIX);
		if (applied) console.log("[HokenSync] Текст из локального кэша установлен в syncLyrics:", cached.artist, "-", cached.title);
		return applied;
	}
	function clearHokenLyricsFromSyncModel(syncLyrics, trackId) {
		if (!syncLyrics?.$treenode?._applySnapshot || typeof syncLyrics.toJSON !== "function") return false;
		const snapshot = JSON.parse(JSON.stringify(syncLyrics.toJSON()));
		snapshot.currentTrackId = String(trackId);
		snapshot.lines = null;
		snapshot.major = null;
		snapshot.lyricId = null;
		snapshot.externalLyricId = null;
		snapshot.writers = [];
		snapshot.hasLyricsViewed = false;
		snapshot.isVisible = false;
		snapshot.loadingState = "REJECT";
		try {
			syncLyrics.$treenode._applySnapshot(snapshot);
			console.log("[HokenSync] Собственный текст очищен из syncLyrics:", trackId);
			return true;
		} catch (error) {
			console.error("[HokenSync] Не удалось очистить syncLyrics:", error);
			return false;
		}
	}
	async function reloadPulseSyncLyrics(syncLyrics, trackId) {
		const track = getCurrentTrack();
		if (!track) return;
		const normalizeCacheValue = (value) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
		const title = normalizeCacheValue(track.title);
		const artist = normalizeCacheValue(track.artist);
		const oldGet = Map.prototype.get;
		let bypassed = 0;
		Map.prototype.get = function(key) {
			const entry = oldGet.call(this, key);
			const value = entry?.value;
			if (String(key) === String(trackId) && value?.lines) {
				bypassed++;
				console.log("[HokenSync] Обошёл syncedByTrackId");
				return;
			}
			if (value?.syncedLyrics && normalizeCacheValue(value.trackName ?? value.title) === title && normalizeCacheValue(value.artistName ?? value.artist) === artist) {
				bypassed++;
				console.log("[HokenSync] Обошёл signatureResults");
				return;
			}
			return entry;
		};
		let request;
		try {
			request = syncLyrics.getData(trackId);
		} finally {
			Map.prototype.get = oldGet;
		}
		await request;
		console.log("[HokenSync] Кэшей обойдено:", bypassed);
	}
	async function forceRefreshSavedLyrics(trackId, initialDelayMs = 400, forcePulseSyncReload = false) {
		const timeoutMs = 8e3;
		const retryDelayMs = 250;
		const startedAt = Date.now();
		if (initialDelayMs > 0) await new Promise((resolve) => {
			window.setTimeout(resolve, initialDelayMs);
		});
		while (Date.now() - startedAt < timeoutMs) {
			const track = getCurrentTrack();
			if (!track || String(track.id) !== String(trackId)) return;
			const syncLyrics = findSyncLyricsModel();
			if (!syncLyrics) {
				await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
				continue;
			}
			const saved = getActiveSavedLyrics(track.title, track.artist);
			if (!saved) {
				if (!forcePulseSyncReload) return;
				clearHokenLyricsFromSyncModel(syncLyrics, trackId);
				try {
					await reloadPulseSyncLyrics(syncLyrics, trackId);
					console.log("[HokenSync] Сохранённого текста больше нет, PulseSync загружен заново:", track.artist, "-", track.title);
				} catch (error) {
					console.warn("[HokenSync] Не удалось перезагрузить PulseSync lyrics:", error);
				}
				return;
			}
			if (String(syncLyrics.currentTrackId) !== String(trackId)) {
				await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
				continue;
			}
			if (syncLyrics.loadingState === "PENDING" || syncLyrics.loadingState === "LOADING") {
				await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
				continue;
			}
			if (applySavedLyricsToSyncModel(syncLyrics, saved, trackId)) return;
		}
		console.warn("[HokenSync] Не удалось обновить lyrics для:", trackId);
	}
	async function refreshCurrentTrackLyrics() {
		const track = getCurrentTrack();
		if (!track?.id) return;
		await forceRefreshSavedLyrics(String(track.id), 100, true);
	}
	function tryCacheResolvedSyncLyrics(track, syncLyrics) {
		if (!track) return;
		if (track.hasNativeSyncLyrics && getLyricsSource(track) !== "lrclib") return;
		if (typeof syncLyrics.externalLyricId === "string" && syncLyrics.externalLyricId.startsWith(HOKEN_EXTERNAL_PREFIX)) return;
		if (syncLyrics.loadingState !== "RESOLVE" || typeof syncLyrics.toJSON !== "function") return;
		const snapshot = JSON.parse(JSON.stringify(syncLyrics.toJSON()));
		if (!Array.isArray(snapshot.lines)) return;
		const lines = snapshot.lines.filter((line) => line && typeof line.text === "string" && typeof line.fromSec === "number" && Number.isFinite(line.fromSec));
		if (!lines.length) return;
		const syncedLyrics = lines.map((line) => {
			const totalSeconds = Math.max(0, line.fromSec);
			const minutes = Math.floor(totalSeconds / 60);
			const seconds = (totalSeconds - minutes * 60).toFixed(2);
			return `[${String(minutes).padStart(2, "0")}:${seconds.padStart(5, "0")}] ${line.text}`;
		}).join("\n");
		if (!syncedLyrics.trim()) return;
		const key = makeKey$1(track.title, track.artist);
		if (cachedSyncLyrics.get(key) === syncedLyrics) return;
		cachedSyncLyrics.set(key, syncedLyrics);
		const plainLyrics = lines.map((line) => line.text).join("\n");
		getCachedLyrics(track.title, track.artist).catch(() => null).then((existing) => {
			if (existing?.edited) return;
			return saveCachedLyrics({
				title: track.title,
				artist: track.artist,
				duration: track.duration,
				plainLyrics,
				syncedLyrics
			}).then(() => {
				console.log("[HokenSync] Текст PulseSync сохранён в кэш:", track.artist, "-", track.title);
			});
		}).catch((error) => {
			console.warn("[HokenSync] Не удалось сохранить текст PulseSync в кэш:", error);
		});
	}
	function normalize$1(value) {
		return String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	}
	function forgetResolvedSyncLyrics(title, artist) {
		cachedSyncLyrics.delete(makeKey$1(title, artist));
	}
	function makeKey$1(title, artist) {
		return `${normalize$1(artist)}|${normalize$1(title)}`;
	}
	var AUTO_SEARCH_RETRY_MS = 30 * 1e3;
	var AUTO_SEARCH_LIMIT_RETRY_MS = 30 * 1e3;
	var autoSearchRunning = /* @__PURE__ */ new Set();
	var autoSearchRetryAt = /* @__PURE__ */ new Map();
	var autoSearchFailed = /* @__PURE__ */ new Map();
	function isHokenSearchRunning(title, artist) {
		return autoSearchRunning.has(makeKey$1(title, artist));
	}
	function getHokenSearchFailure(title, artist) {
		const failure = autoSearchFailed.get(makeKey$1(title, artist));
		if (failure) return failure;
		const limitUntil = getSearchLimitUntil();
		return limitUntil !== null && limitUntil > Date.now() ? "limit" : null;
	}
	async function startAutoSearch(track, key) {
		autoSearchRunning.add(key);
		try {
			const variants = await findLyricsVariants({
				title: track.title,
				artist: track.artist,
				duration: track.duration
			}, false, true);
			autoSearchFailed.delete(key);
			const best = variants.find((variant) => variant.confident);
			if (!best) return;
			await saveCachedLyrics({
				title: track.title,
				artist: track.artist,
				duration: track.duration ?? best.duration,
				plainLyrics: best.plain || void 0,
				syncedLyrics: best.synced,
				foundBy: "hokensync"
			});
			console.log("[HokenSync] PulseSync текст не нашёл, нашёл HokenSync:", track.artist, "-", track.title, "→", best.artistName, "-", best.trackName);
		} catch (error) {
			console.warn("[HokenSync] Автопоиск текста не удался:", error);
			const message = error instanceof Error ? error.message : "";
			const failure = message === "LRCLIB 429" ? "limit" : /^LRCLIB 5\d\d$/.test(message) ? "server" : "network";
			autoSearchRetryAt.set(key, Date.now() + (failure === "limit" ? AUTO_SEARCH_LIMIT_RETRY_MS : AUTO_SEARCH_RETRY_MS));
			autoSearchFailed.set(key, failure);
		} finally {
			autoSearchRunning.delete(key);
		}
	}
	var lyricsRefreshWatcherStarted = false;
	function startLyricsRefreshWatcher() {
		if (lyricsRefreshWatcherStarted) return;
		lyricsRefreshWatcherStarted = true;
		let refreshInFlight = false;
		const check = async () => {
			try {
				const track = getCurrentTrack();
				if (!track?.id) return;
				const trackId = String(track.id);
				const saved = getActiveSavedLyrics(track.title, track.artist);
				const syncLyrics = findSyncLyricsModel();
				if (!syncLyrics) return;
				if (String(syncLyrics.currentTrackId) !== trackId) return;
				const trackKey = makeKey$1(track.title, track.artist);
				const loadingState = syncLyrics.loadingState;
				const isNative = getLyricsSource(track) === "native";
				typeof syncLyrics.externalLyricId === "string" && syncLyrics.externalLyricId.startsWith("hokensync");
				const loadingNow = loadingState === "PENDING" || loadingState === "LOADING";
				if (loadingState === "PENDING" || loadingState === "LOADING") observedLyricsLoading.add(trackKey);
				if (!isNative && (loadingState === "RESOLVE" || loadingState === "REJECT")) observedLyricsSearchFinished.add(trackKey);
				if (loadingNow) observedLyricsLoading.add(trackKey);
				if (!saved) {
					if (getLyricsSource(track) !== "native") {
						const cached = await getCachedLyrics(track.title, track.artist);
						if (cached?.syncedLyrics?.trim()) {
							const expectedCacheExternalId = `${CACHE_EXTERNAL_PREFIX}:${trackId}:${cached.savedAt}`;
							if (syncLyrics.externalLyricId !== expectedCacheExternalId) applyCachedLyricsToSyncModel(syncLyrics, cached, trackId);
							observedLyricsLoading.delete(trackKey);
							return;
						}
					}
					if (loadingState === "RESOLVE" && Array.isArray(syncLyrics.lines) && syncLyrics.lines.some((line) => line && typeof line.text === "string" && line.text.trim() && typeof line.fromSec === "number" && Number.isFinite(line.fromSec))) {
						tryCacheResolvedSyncLyrics(track, syncLyrics);
						return;
					}
					const searchWasObserved = observedLyricsLoading.has(trackKey);
					const searchFinished = loadingState === "RESOLVE" || loadingState === "REJECT";
					loadingState === "RESOLVE" && !Array.isArray(syncLyrics.lines) || loadingState === "RESOLVE" && Array.isArray(syncLyrics.lines) && syncLyrics.lines.some((line) => line && typeof line.text === "string" && line.text.trim() && typeof line.fromSec === "number" && Number.isFinite(line.fromSec));
					if (searchFinished && getLyricsSource(track) !== "native" && (loadingState === "REJECT" || searchWasObserved)) {
						const limitUntil = getSearchLimitUntil();
						if (autoSearchRunning.has(trackKey) || (autoSearchRetryAt.get(trackKey) ?? 0) > Date.now() || limitUntil !== null && limitUntil > Date.now()) return;
						const knownVariants = getCachedVariants(track);
						if (knownVariants === null || knownVariants.some((variant) => variant.confident)) {
							startAutoSearch(track, trackKey);
							return;
						}
						if (knownVariants.length) return;
						if (!await hasLyricsNotFound(track.title, track.artist)) {
							await markLyricsNotFound(track.title, track.artist);
							console.log("[HokenSync] Для трека текст не найден, результат сохранён в память:", track.artist, "-", track.title);
						}
						observedLyricsLoading.delete(trackKey);
					}
					return;
				}
				if (saved && !isNative && observedLyricsSearchFinished.has(trackKey)) {
					if (!(await getCachedLyrics(track.title, track.artist))?.syncedLyrics?.trim()) {
						if (!await hasLyricsNotFound(track.title, track.artist)) {
							await markLyricsNotFound(track.title, track.artist);
							console.log("[HokenSync] Интернет-текст не найден для песни с собственным текстом:", track.artist, "-", track.title);
						}
						observedLyricsSearchFinished.delete(trackKey);
					}
				}
				const expectedExternalId = `${HOKEN_EXTERNAL_PREFIX}:${trackId}:${saved.savedAt}`;
				if (syncLyrics.externalLyricId === expectedExternalId) return;
				if (refreshInFlight) return;
				refreshInFlight = true;
				console.log("[HokenSync] Обнаружена новая версия собственного текста, обновляю:", track.artist, "-", track.title, "savedAt:", saved.savedAt);
				try {
					applySavedLyricsToSyncModel(syncLyrics, saved, trackId);
				} finally {
					refreshInFlight = false;
				}
			} catch (error) {
				console.warn("[HokenSync] Ошибка watcher текста:", error);
			} finally {
				window.setTimeout(() => void check(), 500);
			}
		};
		check();
	}
	//#endregion
	//#region src/yandex/lyrics-interceptor.ts
	var HOKEN_DOWNLOAD_PREFIX = "https://hokensync.local/lyrics/";
	var observedSources = /* @__PURE__ */ new Map();
	var nativeDownloadPayloads = /* @__PURE__ */ new Map();
	var nativeDownloadCounter = 0;
	function normalize(value) {
		return String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	}
	function normalizeTitle(value) {
		let result = String(value ?? "").toLowerCase().replace(/[\[(].*?[\])]/g, " ");
		for (const noise of [
			"cover",
			"remix",
			"legacy",
			"live",
			"acoustic",
			"radioedit",
			"extended",
			"version",
			"edit",
			"paused"
		]) result = result.replace(new RegExp(`\\b${noise}\\b`, "gi"), " ");
		return normalize(result);
	}
	function matchesLrclibTrack(requestedTitle, requestedArtist, item) {
		const itemTitle = String(item.trackName ?? item.track_name ?? item.title ?? item.name ?? "");
		const itemArtist = String(item.artistName ?? item.artist_name ?? item.artist ?? "");
		if (!normalizeTitle(requestedTitle) || !normalizeTitle(itemTitle)) return false;
		if (normalizeTitle(requestedTitle) !== normalizeTitle(itemTitle)) return false;
		const requestedArtistNormalized = normalize(requestedArtist);
		const itemArtistNormalized = normalize(itemArtist);
		if (!requestedArtistNormalized || !itemArtistNormalized) return false;
		return requestedArtistNormalized === itemArtistNormalized;
	}
	function makeKey(title, artist) {
		return `${normalize(artist)}|${normalize(title)}`;
	}
	function getUrl(input) {
		if (typeof input === "string") return input;
		if (input instanceof URL) return input.href;
		return input.url;
	}
	function rememberSource(title, artist, item) {
		const itemTitle = String(item.trackName ?? item.track_name ?? item.title ?? item.name ?? title ?? "");
		const itemArtist = String(item.artistName ?? item.artist_name ?? artist ?? "");
		if (!itemTitle) return;
		const key = makeKey(itemTitle, itemArtist);
		const previous = observedSources.get(key);
		observedSources.set(key, {
			synced: Boolean(item.syncedLyrics) || Boolean(previous?.synced),
			plain: Boolean(item.plainLyrics) || Boolean(previous?.plain),
			updatedAt: Date.now()
		});
	}
	function preparePlaybackLrc(lrc) {
		return lrc;
	}
	function createLrclibItem(saved, requestedTitle, requestedArtist) {
		return {
			id: -999999999,
			name: requestedTitle,
			trackName: requestedTitle,
			artistName: requestedArtist || saved.artist,
			albumName: "HokenSync",
			duration: typeof saved.duration === "number" ? saved.duration : 0,
			instrumental: false,
			hasWordSync: false,
			plainLyrics: saved.lrc.replace(/\[[^\]]*\]/g, "").split(/\r?\n/).filter(Boolean).join("\n"),
			syncedLyrics: preparePlaybackLrc(saved.lrc)
		};
	}
	function createNativeLyricsResponse(saved, trackId) {
		const token = `${trackId}-${++nativeDownloadCounter}`;
		const downloadUrl = `${HOKEN_DOWNLOAD_PREFIX}${encodeURIComponent(token)}`;
		nativeDownloadPayloads.set(downloadUrl, preparePlaybackLrc(saved.lrc));
		return new Response(JSON.stringify({
			downloadUrl,
			lyricId: -999999999,
			externalLyricId: `hokensync:${trackId}:${saved.savedAt}`,
			writers: []
		}), {
			status: 200,
			headers: { "Content-Type": "application/json" }
		});
	}
	function cleanupNativeDownloadPayloads() {
		while (nativeDownloadPayloads.size > 100) {
			const firstKey = nativeDownloadPayloads.keys().next().value;
			if (!firstKey) break;
			nativeDownloadPayloads.delete(firstKey);
		}
	}
	function installLrclibInterceptor() {
		const originalFetch = window.fetch;
		window.fetch = async function(input, init) {
			const url = getUrl(input);
			const hokenDownload = nativeDownloadPayloads.get(url);
			if (hokenDownload !== void 0) {
				cleanupNativeDownloadPayloads();
				return new Response(hokenDownload, {
					status: 200,
					headers: { "Content-Type": "text/plain; charset=utf-8" }
				});
			}
			const nativeMatch = url.match(/^https:\/\/api\.music\.yandex\.net\/tracks\/(\d+)\/lyrics(?:\?|$)/i);
			if (nativeMatch) {
				const currentTrack = getCurrentTrack();
				if (currentTrack && String(currentTrack.id) === nativeMatch[1]) {
					const saved = getActiveSavedLyrics(currentTrack.title, currentTrack.artist);
					if (saved) return createNativeLyricsResponse(saved, nativeMatch[1]);
				}
				const response = await originalFetch.call(this, input, init);
				try {
					const payload = await response.clone().json();
					if (!response.ok || !payload || typeof payload !== "object" || typeof payload.downloadUrl !== "string" || !payload.downloadUrl) return response;
					let hasRealLyrics = false;
					try {
						const lyricsResponse = await originalFetch.call(this, payload.downloadUrl);
						if (lyricsResponse.ok) {
							const lyricsText = (await lyricsResponse.text()).trim();
							const hasLrcLine = /^\[\d+:\d+(?:\.\d+)?\]\s*\S+/m.test(lyricsText);
							hasRealLyrics = hasLrcLine;
							console.log("[HokenSync] Проверка Yandex lyrics:", nativeMatch[1], {
								downloadUrl: payload.downloadUrl,
								responseLength: lyricsText.length,
								hasLrcLine,
								preview: lyricsText.slice(0, 200)
							});
						}
					} catch {
						hasRealLyrics = false;
					}
					if (hasRealLyrics) markNativeLyrics(nativeMatch[1]);
				} catch {}
				return response;
			}
			if ((init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET") ?? "GET").toUpperCase() === "GET" && /lrclib\.net\/api\/(get|search)/.test(url)) {
				const parsed = new URL(url);
				const title = parsed.searchParams.get("track_name");
				const artist = parsed.searchParams.get("artist_name") ?? "";
				const currentTrack = getCurrentTrack();
				const isCurrentTrackRequest = Boolean(currentTrack && title && normalizeTitle(currentTrack.title) === normalizeTitle(title));
				const effectiveArtist = artist || (isCurrentTrackRequest ? currentTrack?.artist ?? "" : "");
				const saved = getActiveSavedLyrics(title, effectiveArtist);
				const isSearch = parsed.pathname.endsWith("/search");
				const savedResponse = () => {
					if (!saved) return null;
					const item = createLrclibItem(saved, title || saved.title, artist || saved.artist);
					return new Response(JSON.stringify(isSearch ? [item] : item), {
						status: 200,
						headers: { "Content-Type": "application/json" }
					});
				};
				const ownResponse = savedResponse();
				if (ownResponse) {
					if (Boolean(artist) || isCurrentTrackRequest) originalFetch.call(this, input, {
						...init,
						signal: AbortSignal.timeout(15e3)
					}).then((real) => {
						reportSearchStatus(real.status);
						return real.ok ? real.json() : null;
					}).then((payload) => {
						const records = Array.isArray(payload) ? payload : payload ? [payload] : [];
						for (const record of records) if (record && typeof record === "object" && matchesLrclibTrack(title ?? "", effectiveArtist, record)) {
							rememberSource(title, effectiveArtist, record);
							markLrclibItem(title, effectiveArtist, record);
						}
					}).catch(() => {});
					return ownResponse;
				}
				const response = await originalFetch.call(this, input, init);
				reportSearchStatus(response.status);
				try {
					const payload = await response.clone().json();
					if (!(Boolean(artist) || isCurrentTrackRequest)) return response;
					if (isSearch && Array.isArray(payload)) {
						const filteredPayload = payload.filter((item) => Boolean(item && typeof item === "object" && matchesLrclibTrack(title ?? "", effectiveArtist, item)));
						if (filteredPayload.length !== payload.length) console.warn("[HokenSync] LRCLIB отбросил несовпадающие песни:", title, "-", effectiveArtist, `оставлено ${filteredPayload.length} из ${payload.length}`);
						for (const record of filteredPayload) {
							rememberSource(title, effectiveArtist, record);
							markLrclibItem(title, effectiveArtist, record);
						}
						const own = savedResponse();
						if (own) return own;
						return new Response(JSON.stringify(filteredPayload), {
							status: 200,
							headers: { "Content-Type": "application/json" }
						});
					}
					if (payload && typeof payload === "object") {
						if (!response.ok) return response;
						const record = payload;
						if (matchesLrclibTrack(title ?? "", effectiveArtist, record)) {
							rememberSource(title, effectiveArtist, record);
							markLrclibItem(title, effectiveArtist, record);
							return savedResponse() ?? response;
						}
						console.warn("[HokenSync] LRCLIB вернул чужую песню, результат отброшен:", title, "-", effectiveArtist);
						return savedResponse() ?? new Response(JSON.stringify({ error: "Track not found" }), {
							status: 404,
							headers: { "Content-Type": "application/json" }
						});
					}
				} catch {}
				return savedResponse() ?? response;
			}
			return originalFetch.call(this, input, init);
		};
		console.log("[HokenSync] LRCLIB interceptor установлен");
		startLyricsRefreshWatcher();
	}
	//#endregion
	//#region src/ui/state.ts
	var uiState = {
		overlay: null,
		content: null,
		currentTrack: null,
		playbackWasPlayingBeforeOpen: false,
		playbackPositionBeforeOpen: 0,
		playbackControlActive: false,
		currentMode: "text",
		editingFound: false,
		syncLines: [],
		sections: [],
		syncIndex: 0,
		reviewIndex: 0,
		reviewReturnIndex: 0,
		reviewReturnTimes: /* @__PURE__ */ new WeakMap(),
		syncAnimationFrame: 0,
		previewWatchFrame: 0,
		previewRunId: 0,
		previewPlaying: false,
		breakClockFrame: 0,
		breakStartTimer: null,
		breakStopTimer: null,
		deleteConfirmOpen: false,
		deleteConfirmElement: null,
		toastContainer: null,
		toastId: 0,
		lyricsMenuWatchTimer: null,
		navigation: {
			showLyricsMenu: () => {},
			showSavedLyricsList: () => {},
			showTextEditor: () => {},
			closeEditor: () => {},
			showSyncScreen: () => {},
			showReviewScreen: () => {},
			showResyncList: () => {},
			startSavedResync: () => {},
			showDoneScreen: () => {},
			startSynchronization: () => {},
			returnToSyncEditing: () => {},
			startBreakForLine: () => {}
		}
	};
	function clearPreviewTimers() {
		uiState.previewRunId += 1;
		if (uiState.breakClockFrame) {
			window.cancelAnimationFrame(uiState.breakClockFrame);
			uiState.breakClockFrame = 0;
		}
		if (uiState.previewWatchFrame) {
			window.cancelAnimationFrame(uiState.previewWatchFrame);
			uiState.previewWatchFrame = 0;
		}
		if (uiState.breakStartTimer !== null) {
			window.clearTimeout(uiState.breakStartTimer);
			uiState.breakStartTimer = null;
		}
		if (uiState.breakStopTimer !== null) {
			window.clearTimeout(uiState.breakStopTimer);
			uiState.breakStopTimer = null;
		}
	}
	//#endregion
	//#region src/ui/tooltip.ts
	var tip = (title, text, keys) => ({
		title,
		text,
		keys
	});
	var SHOW_DELAY_MS = 350;
	var GAP_PX = 10;
	var EDGE_PX = 8;
	var STOP = tip("Стоп", "Остановить фрагмент.");
	var REPEAT_BREAK = tip("Повторить", "Проиграть участок заново. Space.");
	var CLEAR_CACHE = tip("Очистить сохранённые", "Удалить тексты, найденные автоматически. Твои останутся.");
	var DOWNLOAD = tip("Скачать LRC", "Скачать текст песни в читаемый файл на ваш ПК.");
	var DELETE_BREAK = tip("Удалить проигрыш", "Подсветка снова продлится до следующей строки.");
	var END_TIP = tip("Конец строки", "Момент, когда подсветка гаснет.");
	var COPY_TIP = tip("Копировать текст", "Скопировать весь текст песни.");
	var EDIT_LINE_TIP = tip("Изменить текст", "Переписать строку. Enter — применить, Esc — отмена.");
	var ADD_LINE_TIP = tip("Добавить", "Строку ниже или метку части над этой строкой.");
	var CHANGE_LABEL_TIP = tip("Изменить метку", "Заменить на другую.");
	var INSERT_LINE_TIP = tip("Вставить строку", "Новая строка после этой. Enter — добавить, Esc — отмена.");
	var DELETE_LINE_TIP = tip("Удалить строку", "Убрать строку из текста.");
	var BACKUP_SAVE_TIP = tip("Сохранить копию в файл", "Все твои тексты одним файлом .json. Пригодится при переносе на другой ПК или после переустановки.");
	var BACKUP_LOAD_TIP = tip("Загрузить копию из файла", "Выбери файл .json, сохранённый ранее. Новые тексты добавятся, а если песня уже есть, останется более свежая версия.");
	var DELETE_LABEL_TIP = tip("Удалить метку", "Метка исчезнет, строки останутся.");
	var TIPS = new Map([
		["Изменить таймкоды отдельных строк", tip("Изменить таймкоды", "Поправить время строк без новой разметки.")],
		["Начать синхронизацию", tip("Начать разметку", "Песня заиграет с начала. Enter — начало строки.")],
		["Удалить черновик", tip("Удалить черновик", "Стереть незавершённую разметку.")],
		["Найти текст", tip("Найти текст", "Поискать текст этой песни в LRCLIB.")],
		["Форматирование", tip("Форматирование", "Убрать лишние пробелы и знаки в конце строк. Метки остаются.")],
		["Метка", tip("Метка части", "Вставить в место курсора. Выбор — цифрой.", ["Alt", "S"])],
		["Проигрыш", tip("Проигрыш", "Поставить здесь.", ["B"])],
		["Поставить проигрыш", tip("Поставить проигрыш", "Метка на текущем моменте.", ["Enter"])],
		["Изменить", tip("Изменить строку", "Поправить время начала на слух.")],
		["Проигрыш после", tip("Проигрыш после", "Отметить, где он начинается.")],
		["Изменить проигрыш", tip("Изменить проигрыш", "Передвинуть начало проигрыша.")],
		["Задать конец", END_TIP],
		["Изменить конец", END_TIP]
	]);
	var PATTERNS = [
		[/^[−–-]5 с$/, tip("Назад на 5 секунд", "Перемотка песни.", ["←"])],
		[/^\+5 с$/, tip("Вперёд на 5 секунд", "Перемотка песни.", ["→"])],
		[/^[−–-]3 с$/, tip("Назад на 3 секунды", "Зажми — перемотка ускоряется.", ["←"])],
		[/^\+3 с$/, tip("Вперёд на 3 секунды", "Зажми — перемотка ускоряется.", ["→"])]
	];
	var tooltip = null;
	var titleElement = null;
	var textElement = null;
	var keysElement = null;
	var current = null;
	var showTimer = null;
	var visible = false;
	var observer = null;
	function normalizeLabel(raw) {
		return raw.replace(/^[⏮⏸▶⏹♫↩]\uFE0F?\s*/u, "").trim();
	}
	function takeNativeTitle(button) {
		const native = button.getAttribute("title");
		if (!native) return;
		button.dataset.hsLabel = native;
		if (!button.hasAttribute("aria-label")) button.setAttribute("aria-label", native);
		button.removeAttribute("title");
	}
	function resolveTip(button) {
		if (button.disabled) return null;
		if (button.id === "hokensync-cache-clear-btn") return CLEAR_CACHE;
		if (button.classList.contains("hokensync-library-save")) return BACKUP_SAVE_TIP;
		if (button.classList.contains("hokensync-library-load")) return BACKUP_LOAD_TIP;
		if (button.classList.contains("hokensync-saved-lyrics-download")) return DOWNLOAD;
		if (button.classList.contains("hokensync-resync-delete")) return DELETE_BREAK;
		if (button.classList.contains("hokensync-copy-btn")) return COPY_TIP;
		if (button.classList.contains("hokensync-tool-edit")) return EDIT_LINE_TIP;
		if (button.classList.contains("hokensync-tool-add")) return ADD_LINE_TIP;
		if (button.classList.contains("hokensync-tool-insert")) return INSERT_LINE_TIP;
		if (button.classList.contains("hokensync-tool-label")) return CHANGE_LABEL_TIP;
		if (button.classList.contains("hokensync-tool-section")) return DELETE_LABEL_TIP;
		if (button.classList.contains("hokensync-tool-delete")) return DELETE_LINE_TIP;
		const label = normalizeLabel(button.dataset.hsLabel ?? button.textContent ?? "");
		if (button.closest(".hokensync-delete-modal")) return null;
		if (document.getElementById("hokensync-review-line")) return null;
		if (button.id === "hokensync-repeat-btn") return label === "Стоп" ? STOP : REPEAT_BREAK;
		const exact = TIPS.get(label);
		if (exact) return exact;
		for (const [pattern, value] of PATTERNS) if (pattern.test(label)) return value;
		return null;
	}
	function ensureTooltip(overlay) {
		if (tooltip && tooltip.isConnected && tooltip.parentElement === overlay) return tooltip;
		tooltip = document.createElement("div");
		tooltip.id = "hokensync-tooltip";
		tooltip.setAttribute("role", "tooltip");
		const head = document.createElement("div");
		head.className = "hokensync-tooltip-head";
		titleElement = document.createElement("div");
		titleElement.className = "hokensync-tooltip-title";
		keysElement = document.createElement("div");
		keysElement.className = "hokensync-tooltip-keys";
		head.appendChild(titleElement);
		head.appendChild(keysElement);
		textElement = document.createElement("div");
		textElement.className = "hokensync-tooltip-text";
		tooltip.appendChild(head);
		tooltip.appendChild(textElement);
		overlay.appendChild(tooltip);
		return tooltip;
	}
	function place(element, button) {
		const rect = button.getBoundingClientRect();
		const width = element.offsetWidth;
		const height = element.offsetHeight;
		let placement = "top";
		let top = rect.top - height - GAP_PX;
		if (top < EDGE_PX) {
			placement = "bottom";
			top = rect.bottom + GAP_PX;
		}
		top = Math.min(top, window.innerHeight - height - EDGE_PX);
		const left = Math.min(Math.max(EDGE_PX, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - EDGE_PX);
		element.dataset.placement = placement;
		element.style.left = `${Math.round(left)}px`;
		element.style.top = `${Math.round(Math.max(EDGE_PX, top))}px`;
	}
	function showNow(overlay, button, content) {
		if (current !== button || !button.isConnected) return;
		const element = ensureTooltip(overlay);
		if (titleElement) titleElement.textContent = content.title;
		if (textElement) textElement.textContent = content.text;
		if (keysElement) keysElement.replaceChildren(...(content.keys ?? []).map((key) => {
			const cap = document.createElement("kbd");
			cap.textContent = key;
			return cap;
		}));
		place(element, button);
		visible = true;
		element.classList.add("hokensync-tooltip-visible");
	}
	function cancelPending() {
		if (showTimer !== null) {
			window.clearTimeout(showTimer);
			showTimer = null;
		}
	}
	function watchRemoval(overlay) {
		observer?.disconnect();
		observer = new MutationObserver(() => {
			if (current && !current.isConnected) hideTooltip();
		});
		observer.observe(overlay, {
			childList: true,
			subtree: true
		});
	}
	function hideTooltip() {
		cancelPending();
		observer?.disconnect();
		observer = null;
		current = null;
		visible = false;
		tooltip?.classList.remove("hokensync-tooltip-visible");
	}
	function attachTooltip(button, title, text, keys) {
		const content = tip(title, text, keys);
		button.addEventListener("pointerenter", () => {
			const wasVisible = visible;
			cancelPending();
			current = button;
			watchRemoval(document.body);
			if (wasVisible) {
				showNow(document.body, button, content);
				return;
			}
			showTimer = window.setTimeout(() => {
				showTimer = null;
				showNow(document.body, button, content);
			}, SHOW_DELAY_MS);
		});
		button.addEventListener("pointerleave", () => hideTooltip());
		button.addEventListener("pointerdown", () => hideTooltip());
	}
	function installTooltips(overlay) {
		hideTooltip();
		overlay.addEventListener("pointerover", (event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const button = target.closest("button");
			if (!(button instanceof HTMLButtonElement) || !overlay.contains(button)) {
				hideTooltip();
				return;
			}
			if (button === current) return;
			takeNativeTitle(button);
			const content = resolveTip(button);
			if (!content) {
				hideTooltip();
				return;
			}
			const wasVisible = visible;
			cancelPending();
			current = button;
			watchRemoval(overlay);
			if (wasVisible) {
				showNow(overlay, button, content);
				return;
			}
			showTimer = window.setTimeout(() => {
				showTimer = null;
				showNow(overlay, button, content);
			}, SHOW_DELAY_MS);
		});
		overlay.addEventListener("pointerleave", () => hideTooltip());
		overlay.addEventListener("pointerdown", () => hideTooltip(), true);
		overlay.addEventListener("wheel", () => hideTooltip(), {
			capture: true,
			passive: true
		});
	}
	//#endregion
	//#region src/ui/choice-menu.ts
	var menu = null;
	var cleanup = null;
	var openAnchor = null;
	var pickable = [];
	function isChoiceMenuOpen() {
		return menu !== null;
	}
	function pickChoiceByNumber(number) {
		if (!menu) return false;
		const item = pickable[number - 1];
		if (item) {
			closeChoiceMenu();
			item.onPick();
		}
		return true;
	}
	function closeChoiceMenu() {
		if (!menu) return false;
		cleanup?.();
		cleanup = null;
		openAnchor?.classList.remove("is-open");
		openAnchor = null;
		pickable = [];
		const element = menu;
		menu = null;
		element.classList.remove("hokensync-menu-visible");
		window.setTimeout(() => element.remove(), 140);
		return true;
	}
	function openChoiceMenu(anchor, items) {
		if (menu && openAnchor === anchor) {
			closeChoiceMenu();
			return;
		}
		closeChoiceMenu();
		hideTooltip();
		const host = uiState.overlay;
		if (!host) return;
		const element = document.createElement("div");
		element.className = items.some((item) => item.icon) ? "hokensync-menu hokensync-menu-fancy" : "hokensync-menu";
		element.setAttribute("role", "menu");
		let shown = 0;
		for (const item of items) {
			if (item.separator) {
				const line = document.createElement("div");
				line.className = "hokensync-menu-separator";
				element.appendChild(line);
			}
			if (item.heading) {
				const heading = document.createElement("div");
				heading.className = "hokensync-menu-heading";
				heading.textContent = item.label;
				element.appendChild(heading);
				continue;
			}
			if (!item.plain && !item.icon) pickable.push(item);
			const button = document.createElement("button");
			button.type = "button";
			button.className = item.danger ? "hokensync-menu-item danger" : "hokensync-menu-item";
			button.setAttribute("role", "menuitem");
			button.style.setProperty("--i", String(shown));
			shown += 1;
			const number = document.createElement("span");
			if (item.icon) {
				number.className = "hokensync-menu-num hokensync-menu-icon";
				number.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg>`;
			} else {
				number.className = "hokensync-menu-num";
				number.textContent = item.plain ? item.badge ?? "+" : String(pickable.length);
			}
			const label = document.createElement("span");
			label.textContent = item.label;
			button.appendChild(number);
			button.appendChild(label);
			button.addEventListener("click", () => {
				closeChoiceMenu();
				item.onPick();
			});
			element.appendChild(button);
		}
		host.appendChild(element);
		const rect = anchor.getBoundingClientRect();
		const width = element.offsetWidth;
		const height = element.offsetHeight;
		let top = rect.top - height - 8;
		let placement = "top";
		if (top < 8) {
			top = rect.bottom + 8;
			placement = "bottom";
		}
		top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
		const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
		element.dataset.placement = placement;
		element.style.left = `${Math.round(left)}px`;
		element.style.top = `${Math.round(top)}px`;
		menu = element;
		openAnchor = anchor;
		anchor.classList.add("is-open");
		element.offsetWidth;
		element.classList.add("hokensync-menu-visible");
		const onPointerDown = (event) => {
			const target = event.target;
			if (target instanceof Node && (element.contains(target) || anchor.contains(target))) return;
			closeChoiceMenu();
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		cleanup = () => window.removeEventListener("pointerdown", onPointerDown, true);
	}
	//#endregion
	//#region src/ui/common.ts
	var scrollbarHideTimers = /* @__PURE__ */ new WeakMap();
	function revealScrollbar(target) {
		if (!(target instanceof HTMLElement)) return;
		if (!target.matches("#hokensync-textarea, #hokensync-preview, #hokensync-resync-list, #hokensync-saved-lyrics-list")) return;
		target.classList.remove("hokensync-scroll-hiding");
		target.classList.add("hokensync-scroll-visible");
		const oldTimer = scrollbarHideTimers.get(target);
		if (oldTimer !== void 0) window.clearTimeout(oldTimer);
		const timer = window.setTimeout(() => {
			target.classList.remove("hokensync-scroll-visible");
			target.classList.add("hokensync-scroll-hiding");
			const hideTimer = window.setTimeout(() => {
				target.classList.remove("hokensync-scroll-hiding");
				scrollbarHideTimers.delete(target);
			}, 300);
			scrollbarHideTimers.set(target, hideTimer);
		}, 700);
		scrollbarHideTimers.set(target, timer);
	}
	function stopLyricsMenuWatch() {
		if (uiState.lyricsMenuWatchTimer !== null) {
			window.clearInterval(uiState.lyricsMenuWatchTimer);
			uiState.lyricsMenuWatchTimer = null;
		}
	}
	function createButton(text, onClick, className = "") {
		const button = document.createElement("button");
		button.className = `hokensync-btn ${className}`.trim();
		button.type = "button";
		button.textContent = text;
		button.addEventListener("click", onClick);
		return button;
	}
	function setContent() {
		closeChoiceMenu();
		if (uiState.content) {
			uiState.content.innerHTML = "";
			uiState.content.classList.remove("hokensync-no-enter");
		}
		document.getElementById("hokensync-cache-clear-btn")?.remove();
	}
	function setStatus(text, type = "normal") {
		const status = document.createElement("div");
		status.id = "hokensync-status";
		status.textContent = text;
		if (type === "success") status.classList.add("hokensync-status-success");
		if (type === "error") status.classList.add("hokensync-status-error");
		return status;
	}
	var SMOOTH_SCROLL_SELECTOR = "#hokensync-textarea, #hokensync-preview, #hokensync-resync-list, #hokensync-saved-lyrics-list";
	var SMOOTH_SCROLL_SPEED = 10;
	var smoothScrollStates = /* @__PURE__ */ new WeakMap();
	function scrollSmoothly(element, delta) {
		const max = Math.max(0, element.scrollHeight - element.clientHeight);
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			element.scrollTop = Math.max(0, Math.min(max, element.scrollTop + delta));
			return;
		}
		let state = smoothScrollStates.get(element);
		const base = state && state.frame ? state.target : element.scrollTop;
		const target = Math.max(0, Math.min(max, base + delta));
		if (!state) {
			state = {
				target,
				expected: element.scrollTop,
				frame: 0,
				last: 0
			};
			smoothScrollStates.set(element, state);
		}
		state.target = target;
		if (state.frame) return;
		const current = state;
		current.expected = element.scrollTop;
		current.last = performance.now();
		const step = (now) => {
			if (!element.isConnected) {
				current.frame = 0;
				return;
			}
			if (Math.abs(element.scrollTop - current.expected) > 2) {
				current.frame = 0;
				return;
			}
			const seconds = Math.min(.05, (now - current.last) / 1e3);
			current.last = now;
			const distance = current.target - element.scrollTop;
			if (Math.abs(distance) < .6) {
				element.scrollTop = current.target;
				current.frame = 0;
				return;
			}
			const move = distance * (1 - Math.exp(-SMOOTH_SCROLL_SPEED * seconds));
			element.scrollTop += Math.abs(move) < 1 ? Math.sign(distance) : move;
			current.expected = element.scrollTop;
			current.frame = window.requestAnimationFrame(step);
		};
		current.frame = window.requestAnimationFrame(step);
	}
	function installSmoothWheel(root) {
		root.addEventListener("wheel", (event) => {
			const target = event.target instanceof Element ? event.target.closest(SMOOTH_SCROLL_SELECTOR) : null;
			if (!target || event.ctrlKey || event.shiftKey || event.deltaY === 0) return;
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * target.clientHeight : event.deltaY;
			event.preventDefault();
			event.stopPropagation();
			revealScrollbar(target);
			scrollSmoothly(target, delta);
		}, {
			capture: true,
			passive: false
		});
	}
	//#endregion
	//#region src/ui/icons.ts
	var svg = (shapes) => `<svg viewBox="0 0 24 24" aria-hidden="true">${shapes}</svg>`;
	var ICONS = {
		check: svg("<path d=\"M5 12.5l4.5 4.5L19 7.5\"/>"),
		plus: svg("<path d=\"M12 5v14M5 12h14\"/>"),
		close: svg("<path d=\"M5.5 5.5l13 13M18.5 5.5l-13 13\"/>"),
		trash: svg("<path d=\"M5 7h14\"/><path d=\"M9.5 7V4.8h5V7\"/><path d=\"M6.6 7l.9 11.4a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8L17.4 7\"/><path d=\"M10.2 11v5.2M13.8 11v5.2\"/>"),
		pencil: svg("<path d=\"M4.6 19.4l.9-4.1L16.3 4.5a2 2 0 0 1 2.9 0l.3.3a2 2 0 0 1 0 2.9L8.7 18.5z\"/><path d=\"M14.5 6.3l3.2 3.2\"/>"),
		rowPlus: svg("<path d=\"M4 6.5h11M4 11.5h7M4 16.5h5\"/><path d=\"M17.5 12.5v7M14 16h7\"/>"),
		save: svg("<path d=\"M5.5 4.5H16l3.5 3.5V19a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z\"/><path d=\"M8 4.5V9h7V4.5\"/><path d=\"M8 20v-5.5h8V20\"/>"),
		upload: svg("<path d=\"M12 16V5.5M7.6 9.6L12 5.2l4.4 4.4\"/><path d=\"M5 15.5V18a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5\"/>"),
		download: svg("<path d=\"M12 5v10.5M7.6 11.4L12 15.8l4.4-4.4\"/><path d=\"M5 15.5V18a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5\"/>"),
		format: svg("<path d=\"M5 6h14M5 10.5h9.5M5 15h14M5 19.5h8\"/>"),
		search: svg("<circle cx=\"11\" cy=\"11\" r=\"5.8\"/><path d=\"M15.4 15.4L19.5 19.5\"/>"),
		paperclip: svg("<path d=\"M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6\"/>"),
		tag: svg("<path d=\"M4.5 12.2V5.5a1 1 0 0 1 1-1h6.7a1 1 0 0 1 .7.3l6.5 6.5a1 1 0 0 1 0 1.4l-6.7 6.7a1 1 0 0 1-1.4 0l-6.5-6.5a1 1 0 0 1-.3-.7z\"/><circle cx=\"9\" cy=\"9\" r=\"1.2\"/>"),
		error: svg("<circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4\"/>"),
		warning: svg("<path d=\"M12 4.8l8.2 14.2H3.8z\"/><path d=\"M12 10.2v4M12 16.8v.1\"/>"),
		info: svg("<circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M12 11v5M12 8v.1\"/>")
	};
	//#endregion
	//#region src/ui/toast.ts
	var TYPE_ICONS = {
		success: ICONS.check,
		error: ICONS.error,
		warning: ICONS.warning,
		info: ICONS.info,
		delete: ICONS.trash
	};
	var LIFETIME_MS = 5e3;
	function showToast(message, type = "success", description = "") {
		if (!uiState.toastContainer) {
			uiState.toastContainer = document.createElement("div");
			uiState.toastContainer.id = "hokensync-toast-container";
			document.body.appendChild(uiState.toastContainer);
		}
		const toast = document.createElement("div");
		const icon = document.createElement("div");
		const body = document.createElement("div");
		const title = document.createElement("div");
		const text = document.createElement("div");
		const close = document.createElement("button");
		const progress = document.createElement("div");
		const id = ++uiState.toastId;
		toast.className = `hokensync-toast hokensync-toast-${type}`;
		toast.dataset.toastId = String(id);
		toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
		icon.className = "hokensync-toast-icon";
		icon.innerHTML = TYPE_ICONS[type];
		body.className = "hokensync-toast-body";
		title.className = "hokensync-toast-title";
		title.textContent = message;
		text.className = "hokensync-toast-text";
		text.textContent = description;
		body.appendChild(title);
		if (description) body.appendChild(text);
		close.type = "button";
		close.className = "hokensync-toast-close";
		close.setAttribute("aria-label", "Закрыть уведомление");
		close.innerHTML = ICONS.close;
		progress.className = "hokensync-toast-progress";
		toast.appendChild(icon);
		toast.appendChild(body);
		toast.appendChild(close);
		toast.appendChild(progress);
		uiState.toastContainer.appendChild(toast);
		let timer = 0;
		const removeToast = () => {
			if (toast.dataset.removing === "true") return;
			window.clearTimeout(timer);
			toast.dataset.removing = "true";
			toast.classList.add("hokensync-toast-hiding");
			window.setTimeout(() => {
				toast.remove();
				if (uiState.toastContainer && uiState.toastContainer.children.length === 0) {
					uiState.toastContainer.remove();
					uiState.toastContainer = null;
				}
			}, 220);
		};
		close.addEventListener("click", removeToast);
		timer = window.setTimeout(removeToast, LIFETIME_MS);
	}
	var BANNER_HIDE_MS = 300;
	var bannerContainer = null;
	function showBanner(options) {
		if (!bannerContainer) {
			bannerContainer = document.createElement("div");
			bannerContainer.id = "hokensync-banner-container";
			document.body.appendChild(bannerContainer);
		}
		const banner = document.createElement("div");
		const fill = document.createElement("div");
		const icon = document.createElement("div");
		const body = document.createElement("div");
		const title = document.createElement("div");
		const text = document.createElement("div");
		banner.className = "hokensync-banner hokensync-banner-plain";
		banner.setAttribute("role", "status");
		fill.className = "hokensync-banner-fill";
		icon.className = "hokensync-banner-icon";
		body.className = "hokensync-banner-body";
		title.className = "hokensync-banner-title";
		text.className = "hokensync-banner-text";
		body.appendChild(title);
		body.appendChild(text);
		banner.appendChild(fill);
		banner.appendChild(icon);
		banner.appendChild(body);
		bannerContainer.appendChild(banner);
		const apply = (patch) => {
			if (patch.title !== void 0) title.textContent = patch.title;
			if (patch.description !== void 0) {
				text.textContent = patch.description;
				text.hidden = !patch.description;
			}
			if (patch.icon !== void 0) icon.innerHTML = patch.icon;
			if (patch.tone) banner.dataset.tone = patch.tone;
			if (patch.progress !== void 0) {
				banner.classList.remove("hokensync-banner-plain");
				banner.style.setProperty("--banner-progress", String(Math.min(1, Math.max(0, patch.progress))));
			}
		};
		apply({
			tone: "info",
			description: "",
			...options,
			progress: options.progress === void 0 ? void 0 : 0
		});
		if (options.progress !== void 0) {
			banner.offsetWidth;
			apply({ progress: options.progress });
		}
		let closed = false;
		let closeTimer = 0;
		const close = (afterMs = 0) => {
			window.clearTimeout(closeTimer);
			if (closed) return;
			if (afterMs > 0) {
				closeTimer = window.setTimeout(() => close(0), afterMs);
				return;
			}
			closed = true;
			banner.classList.add("hokensync-banner-hiding");
			window.setTimeout(() => {
				banner.remove();
				if (bannerContainer && bannerContainer.children.length === 0) {
					bannerContainer.remove();
					bannerContainer = null;
				}
			}, BANNER_HIDE_MS);
		};
		return {
			update: apply,
			close
		};
	}
	var LIMIT_LIFTED_SHOW_MS = 2e3;
	var limitBanner = null;
	var limitTimer = 0;
	var limitStarted = false;
	function stopLimitTimer() {
		window.clearTimeout(limitTimer);
		limitTimer = 0;
	}
	function handleSearchLimit(until) {
		stopLimitTimer();
		if (until === null) {
			limitBanner?.update({
				title: "Ограничение снято",
				description: "Запросы к LRCLIB снова проходят.",
				icon: ICONS.check,
				tone: "success"
			});
			limitBanner?.close(LIMIT_LIFTED_SHOW_MS);
			limitBanner = null;
			return;
		}
		if (!limitBanner) limitBanner = showBanner({
			title: "LRCLIB ограничил запросы",
			description: "Поиск продолжится, как только сервер начнёт отвечать.",
			icon: ICONS.warning,
			tone: "warning"
		});
		limitTimer = window.setTimeout(() => {
			limitBanner?.close();
			limitBanner = null;
		}, Math.max(0, until - Date.now()));
	}
	function startSearchLimitBanner() {
		if (limitStarted) return;
		limitStarted = true;
		onSearchLimitChange(handleSearchLimit);
		const current = getSearchLimitUntil();
		if (current !== null) handleSearchLimit(current);
	}
	function createBackup() {
		const lyrics = Object.values(loadLyricsDatabase()).filter((item) => item?.lrc?.trim());
		const now = /* @__PURE__ */ new Date();
		const file = {
			app: "HokenSync",
			schema: 1,
			exportedAt: now.toISOString(),
			lyrics,
			disabled: loadDisabledMap()
		};
		return {
			fileName: `HokenSync-backup-${now.toISOString().slice(0, 10)}.json`,
			content: JSON.stringify(file, null, 2),
			count: lyrics.length
		};
	}
	function isValidEntry(value) {
		const item = value;
		return Boolean(item && typeof item.title === "string" && typeof item.artist === "string" && typeof item.lrc === "string" && item.lrc.trim());
	}
	function restoreBackup(content) {
		let data;
		try {
			data = JSON.parse(content);
		} catch {
			throw new Error("Это не файл резервной копии HokenSync.");
		}
		if (data.app !== "HokenSync" || !Array.isArray(data.lyrics)) throw new Error("Это не файл резервной копии HokenSync.");
		if (typeof data.schema === "number" && data.schema > 1) throw new Error("Копия создана более новой версией HokenSync. Обнови аддон.");
		const database = loadLyricsDatabase();
		const result = {
			added: 0,
			updated: 0,
			skipped: 0
		};
		for (const entry of data.lyrics) {
			if (!isValidEntry(entry)) {
				result.skipped += 1;
				continue;
			}
			const key = makeLyricsKey(entry.artist, entry.title);
			const existing = database[key];
			if (!existing) {
				database[key] = entry;
				result.added += 1;
			} else if ((entry.savedAt ?? 0) > (existing.savedAt ?? 0)) {
				database[key] = entry;
				result.updated += 1;
			} else result.skipped += 1;
		}
		saveLyricsDatabase(database);
		if (data.disabled && typeof data.disabled === "object") saveDisabledMap({
			...loadDisabledMap(),
			...data.disabled
		});
		return result;
	}
	//#endregion
	//#region src/ui/text-highlight.ts
	function attachSectionHighlight(textarea, backdrop) {
		const render = () => {
			const fragment = document.createDocumentFragment();
			const lines = textarea.value.split("\n");
			lines.forEach((line, index) => {
				const span = document.createElement("span");
				if (isSectionLabel(line)) span.className = "hokensync-hl-label";
				span.textContent = line;
				fragment.appendChild(span);
				if (index < lines.length - 1) fragment.appendChild(document.createTextNode("\n"));
			});
			fragment.appendChild(document.createTextNode("​"));
			backdrop.replaceChildren(fragment);
			backdrop.scrollTop = textarea.scrollTop;
		};
		textarea.addEventListener("input", render);
		textarea.addEventListener("scroll", () => {
			backdrop.scrollTop = textarea.scrollTop;
		});
		render();
		return render;
	}
	//#endregion
	//#region src/ui/variants-screen.ts
	var BRACKET_PATTERN = /\([^)]*\)|\[[^\]]*\]/g;
	var BRACKET_SPLIT = /(\([^)]*\)|\[[^\]]*\])/;
	var BRACKET_WHOLE = /^(?:\([^)]*\)|\[[^\]]*\])$/;
	var MAX_HUNKS = 12;
	var MAX_POSITIONS = 4;
	function normalizeText(value) {
		return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	}
	function clock(seconds) {
		const safe = Math.max(0, Math.round(seconds));
		return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
	}
	function shorten(text, limit = 36) {
		return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
	}
	function pluralLines(value) {
		const last = value % 10;
		const lastTwo = value % 100;
		if (lastTwo >= 11 && lastTwo <= 14) return "строк";
		if (last === 1) return "строка";
		if (last >= 2 && last <= 4) return "строки";
		return "строк";
	}
	function pluralPlaces(value) {
		const last = value % 10;
		const lastTwo = value % 100;
		if (lastTwo >= 11 && lastTwo <= 14) return "мест";
		if (last === 1) return "место";
		if (last >= 2 && last <= 4) return "места";
		return "мест";
	}
	function analyze(card) {
		const parsed = card.synced ? parseLrc(card.synced) : [];
		const textLines = parsed.filter((line) => !line.isBreak);
		const lines = card.synced ? textLines.map((line) => line.text) : card.plain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		const lastIsBreak = parsed.length > 0 && Boolean(parsed[parsed.length - 1].isBreak);
		const breaks = Math.max(0, parsed.filter((line) => line.isBreak).length - (lastIsBreak ? 1 : 0));
		const samples = [];
		let brackets = 0;
		for (const line of lines) {
			const found = line.match(BRACKET_PATTERN);
			if (!found) continue;
			brackets += 1;
			for (const part of found) if (samples.length < 3 && !samples.includes(part)) samples.push(part);
		}
		return {
			lines,
			times: card.synced ? textLines.map((line) => line.time) : lines.map(() => null),
			fullKeys: lines.map(normalizeText),
			breaks,
			firstTime: textLines.length ? textLines[0].time : null,
			lastTime: textLines.length ? textLines[textLines.length - 1].time : null,
			brackets,
			samples
		};
	}
	function isSameVersion(a, x, b, y) {
		if (Boolean(a.synced) !== Boolean(b.synced)) return false;
		if (x.breaks !== y.breaks) return false;
		if (x.fullKeys.length !== y.fullKeys.length) return false;
		if (x.fullKeys.some((key, index) => key !== y.fullKeys[index])) return false;
		return x.times.every((time, index) => {
			const other = y.times[index];
			return time === null || other === null || other === void 0 || Math.abs(time - other) <= .5;
		});
	}
	function mergeIdenticalVersions(cards) {
		const result = [];
		for (const card of cards) {
			const data = analyze(card);
			const twin = result.find((item) => isSameVersion(item.card, item.data, card, data));
			if (!twin) {
				result.push({
					card: {
						...card,
						copies: 0,
						alsoNamed: []
					},
					data
				});
				continue;
			}
			twin.card.copies = (twin.card.copies ?? 0) + 1;
			const label = `${card.artistName} — ${card.trackName}`;
			if (label !== `${twin.card.artistName} — ${twin.card.trackName}` && !twin.card.alsoNamed?.includes(label)) twin.card.alsoNamed?.push(label);
			if (card.current && !twin.card.current) {
				twin.card.current = true;
				twin.card.origin = card.origin;
			}
			if (card.confident) twin.card.confident = true;
		}
		return result.map((item) => item.card);
	}
	function lcsMatches(a, b) {
		const table = [];
		for (let i = 0; i <= a.length; i += 1) table.push(new Array(b.length + 1).fill(0));
		for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
		const matches = [];
		let i = 0;
		let j = 0;
		while (i < a.length && j < b.length) if (a[i] === b[j]) {
			matches.push([i, j]);
			i += 1;
			j += 1;
		} else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
		else j += 1;
		return matches;
	}
	function buildHunks(reference, data) {
		const matches = lcsMatches(reference.fullKeys, data.fullKeys);
		const hunks = [];
		let refPos = 0;
		let cardPos = 0;
		const flush = (refEnd, cardEnd) => {
			if (refEnd > refPos || cardEnd > cardPos) hunks.push({
				cardStart: cardPos,
				removed: reference.lines.slice(refPos, refEnd),
				added: data.lines.slice(cardPos, cardEnd)
			});
		};
		for (const [refIndex, cardIndex] of matches) {
			flush(refIndex, cardIndex);
			refPos = refIndex + 1;
			cardPos = cardIndex + 1;
		}
		flush(reference.lines.length, data.lines.length);
		return {
			hunks,
			common: matches.length,
			similar: matches.length / Math.max(1, reference.lines.length, data.lines.length)
		};
	}
	function diffWords(from, to) {
		const a = from.split(/\s+/).filter(Boolean);
		const b = to.split(/\s+/).filter(Boolean);
		const matches = lcsMatches(a.map(normalizeText), b.map(normalizeText));
		const keptA = new Set(matches.map((pair) => pair[0]));
		const keptB = new Set(matches.map((pair) => pair[1]));
		return {
			from: a.map((word, index) => ({
				text: word,
				changed: !keptA.has(index)
			})),
			to: b.map((word, index) => ({
				text: word,
				changed: !keptB.has(index)
			}))
		};
	}
	function createChip(text, tone = "") {
		const chip = document.createElement("span");
		chip.className = tone ? `hokensync-version-chip ${tone}` : "hokensync-version-chip";
		chip.textContent = text;
		return chip;
	}
	function createPreview(lines) {
		const preview = document.createElement("div");
		preview.className = "hokensync-version-preview";
		for (const line of lines.slice(0, 3)) {
			const row = document.createElement("div");
			for (const part of line.split(BRACKET_SPLIT)) {
				if (!part) continue;
				if (BRACKET_WHOLE.test(part)) {
					const paren = document.createElement("span");
					paren.className = "hokensync-version-paren";
					paren.textContent = part;
					row.appendChild(paren);
				} else row.appendChild(document.createTextNode(part));
			}
			preview.appendChild(row);
		}
		if (lines.length > 3) {
			const more = document.createElement("div");
			more.textContent = "…";
			preview.appendChild(more);
		}
		return preview;
	}
	function describeDifference(card, data, reference, diff) {
		const parts = [];
		if (normalizeText(card.trackName) !== normalizeText(reference.card.trackName)) parts.push("другое название");
		if (Boolean(card.synced) !== Boolean(reference.card.synced)) parts.push(card.synced ? "есть таймкоды" : "нет таймкодов");
		if (data.firstTime !== null && reference.data.firstTime !== null) {
			const shift = data.firstTime - reference.data.firstTime;
			if (Math.abs(shift) >= 1) parts.push(`текст начинается на ${Math.round(Math.abs(shift))} с ${shift > 0 ? "позже" : "раньше"}`);
		}
		if (card.synced && reference.card.synced && data.breaks !== reference.data.breaks) parts.push(`проигрышей ${data.breaks} вместо ${reference.data.breaks}`);
		if (data.brackets !== reference.data.brackets) parts.push(data.brackets > reference.data.brackets ? "больше слов в скобках" : "меньше слов в скобках");
		if (diff.similar < .3) parts.push("текст совсем другой");
		else {
			let changed = 0;
			let added = 0;
			let removed = 0;
			for (const hunk of diff.hunks) {
				const pair = Math.min(hunk.removed.length, hunk.added.length);
				changed += pair;
				added += hunk.added.length - pair;
				removed += hunk.removed.length - pair;
			}
			if (changed) parts.push(`изменено ${changed} ${pluralLines(changed)}`);
			if (added) parts.push(`добавлено ${added} ${pluralLines(added)}`);
			if (removed) parts.push(`нет ${removed} ${pluralLines(removed)}`);
			if (!changed && !added && !removed) parts.push("текст тот же");
		}
		return `Чем отличается от ${reference.card.current ? "текущей (№1)" : "№1"}: ${parts.join(" · ")}`;
	}
	function appendWords(target, parts) {
		parts.forEach((part, index) => {
			if (index > 0) target.appendChild(document.createTextNode(" "));
			if (part.changed) {
				const word = document.createElement("span");
				word.className = "hokensync-diff-word";
				word.textContent = part.text;
				target.appendChild(word);
			} else target.appendChild(document.createTextNode(part.text));
		});
	}
	function createDiffRow(kind, who, parts) {
		const row = document.createElement("div");
		const mark = document.createElement("span");
		const label = document.createElement("span");
		const text = document.createElement("span");
		row.className = `hokensync-diff-row ${kind}`;
		mark.className = "hokensync-diff-mark";
		mark.textContent = kind === "del" ? "−" : "+";
		label.className = "hokensync-diff-who";
		label.textContent = who;
		text.className = "hokensync-diff-text";
		appendWords(text, parts);
		row.appendChild(mark);
		row.appendChild(label);
		row.appendChild(text);
		return row;
	}
	function createHunk(hunk, cardNumber, data) {
		const item = document.createElement("div");
		const where = document.createElement("div");
		item.className = "hokensync-diff-hunk";
		where.className = "hokensync-diff-where";
		const first = hunk.cardStart;
		const count = hunk.added.length;
		let place;
		if (count === 0) place = first === 0 ? "В самом начале" : first >= data.lines.length ? "В самом конце" : `Между строками ${first} и ${first + 1}`;
		else place = count === 1 ? `Строка ${first + 1}` : `Строки ${first + 1}–${first + count}`;
		const time = data.times[Math.min(first, data.times.length - 1)];
		const previous = first > 0 ? data.lines[first - 1] : "";
		where.textContent = [
			place,
			typeof time === "number" ? clock(time) : "",
			previous ? `после «${shorten(previous)}»` : ""
		].filter(Boolean).join(" · ");
		item.appendChild(where);
		const total = Math.max(hunk.removed.length, hunk.added.length);
		const shown = Math.min(total, MAX_POSITIONS);
		for (let index = 0; index < shown; index += 1) {
			const before = hunk.removed[index];
			const after = hunk.added[index];
			if (before !== void 0 && after !== void 0) {
				const words = diffWords(before, after);
				item.appendChild(createDiffRow("del", "№1", words.from));
				item.appendChild(createDiffRow("add", `№${cardNumber}`, words.to));
			} else if (before !== void 0) item.appendChild(createDiffRow("del", "№1", [{
				text: before,
				changed: false
			}]));
			else if (after !== void 0) item.appendChild(createDiffRow("add", `№${cardNumber}`, [{
				text: after,
				changed: false
			}]));
		}
		if (total > shown) {
			const more = document.createElement("div");
			more.className = "hokensync-diff-more";
			more.textContent = `…и ещё ${total - shown} ${pluralLines(total - shown)} в этом месте`;
			item.appendChild(more);
		}
		return item;
	}
	function createDiffBox(cardNumber, data, reference, diff) {
		const box = document.createElement("div");
		box.className = "hokensync-version-diffbox";
		box.hidden = true;
		if (diff.similar < .3) {
			const note = document.createElement("div");
			note.className = "hokensync-diff-note";
			note.textContent = `Тексты почти не совпадают: общих строк ${diff.common} из ${Math.max(reference.lines.length, data.lines.length)}. Скорее всего это другой текст, перевод или другая запись.`;
			box.appendChild(note);
			return box;
		}
		const legend = document.createElement("div");
		legend.className = "hokensync-diff-note";
		legend.textContent = `− строка из №1, + строка из №${cardNumber}. Изменённые слова выделены. Регистр и знаки препинания не сравниваются.`;
		box.appendChild(legend);
		for (const hunk of diff.hunks.slice(0, MAX_HUNKS)) box.appendChild(createHunk(hunk, cardNumber, data));
		if (diff.hunks.length > MAX_HUNKS) {
			const more = document.createElement("div");
			more.className = "hokensync-diff-more";
			more.textContent = `Показаны первые ${MAX_HUNKS} мест из ${diff.hunks.length}.`;
			box.appendChild(more);
		}
		return box;
	}
	function renderVersionsScreen(options) {
		if (!uiState.content) return;
		uiState.currentMode = "text";
		setContent();
		const { track, cards } = options;
		const analyses = cards.map(analyze);
		const reference = {
			card: cards[0],
			data: analyses[0]
		};
		const wrapper = document.createElement("div");
		wrapper.id = "hokensync-library";
		const header = document.createElement("div");
		header.id = "hokensync-library-header";
		const headerIcon = document.createElement("div");
		headerIcon.className = "hokensync-library-header-icon";
		headerIcon.textContent = "♫";
		const headerText = document.createElement("div");
		headerText.className = "hokensync-library-header-text";
		const title = document.createElement("div");
		title.className = "hokensync-library-title";
		title.textContent = "Выбор версии текста";
		const description = document.createElement("div");
		description.className = "hokensync-library-description";
		description.textContent = options.mode === "found" ? "Выбери версию, которую плеер будет использовать как найденный текст. Смотри, с какой строки он начинается." : "Версии отличаются таймкодами, проигрышами, названием и словами в скобках. Сравни и выбери.";
		headerText.appendChild(title);
		headerText.appendChild(description);
		const count = document.createElement("div");
		count.className = "hokensync-library-count";
		count.textContent = `${cards.length} ${cards.length < 5 ? "версии" : "версий"}`;
		header.appendChild(headerIcon);
		header.appendChild(headerText);
		header.appendChild(count);
		const list = document.createElement("div");
		list.id = "hokensync-saved-lyrics-list";
		list.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
		cards.forEach((card, index) => {
			const data = analyses[index];
			const diff = index > 0 ? buildHunks(reference.data, data) : null;
			const item = document.createElement("div");
			item.className = card.current ? "hokensync-version current" : "hokensync-version";
			const head = document.createElement("div");
			head.className = "hokensync-version-head";
			const number = document.createElement("span");
			number.className = "hokensync-version-num";
			number.textContent = String(index + 1);
			const name = document.createElement("div");
			name.className = "hokensync-version-name";
			name.textContent = `${card.artistName || track.artist} — ${card.trackName || track.title}`;
			head.appendChild(number);
			head.appendChild(name);
			if (card.current) {
				const tag = document.createElement("span");
				tag.className = "hokensync-version-tag";
				tag.textContent = "Сейчас подставлено";
				head.appendChild(tag);
			}
			const origin = document.createElement("div");
			origin.className = "hokensync-version-origin";
			origin.textContent = `Источник: ${card.origin}` + (card.copies ? ` · объединено одинаковых: ${card.copies}` : "");
			const chips = document.createElement("div");
			chips.className = "hokensync-version-chips";
			chips.appendChild(createChip(card.synced ? "С таймкодами" : "Только текст", card.synced ? "ok" : "warn"));
			if (card.duration !== void 0) if (track.duration !== void 0) {
				const gap = card.duration - track.duration;
				const close = Math.abs(gap) < 1.5;
				const note = close ? "как у трека" : `${gap > 0 ? "+" : "−"}${Math.round(Math.abs(gap))} с`;
				chips.appendChild(createChip(`${clock(card.duration)} (${note})`, close ? "ok" : Math.abs(gap) <= 5 ? "" : "warn"));
			} else chips.appendChild(createChip(clock(card.duration)));
			else chips.appendChild(createChip("Длительность неизвестна", "warn"));
			const sameTitle = normalizeText(card.trackName) === normalizeText(track.title);
			const sameArtist = normalizeText(card.artistName) === normalizeText(track.artist);
			if (sameTitle && sameArtist) chips.appendChild(createChip("Название и исполнитель совпадают", "ok"));
			else {
				if (!sameTitle) chips.appendChild(createChip(`Название: «${card.trackName}»`, "warn"));
				if (!sameArtist) chips.appendChild(createChip(`Исполнитель: «${card.artistName}»`, "warn"));
			}
			if (card.synced && data.firstTime !== null && data.lastTime !== null) {
				chips.appendChild(createChip(`Текст: ${clock(data.firstTime)} – ${clock(data.lastTime)}`));
				chips.appendChild(createChip(data.breaks ? `Проигрышей: ${data.breaks}` : "Без проигрышей"));
			}
			chips.appendChild(createChip(`Строк: ${data.lines.length}`));
			chips.appendChild(createChip(data.brackets ? `В скобках: ${data.brackets} стр.` : "Без скобок", data.brackets ? "warn" : ""));
			item.appendChild(head);
			item.appendChild(origin);
			if (card.alsoNamed?.length) {
				const named = document.createElement("div");
				const shown = card.alsoNamed.slice(0, 3).join("; ");
				const rest = card.alsoNamed.length - 3;
				named.className = "hokensync-version-origin";
				named.textContent = `Тот же текст с теми же таймкодами у записей: ${shown}${rest > 0 ? ` и ещё ${rest}` : ""}`;
				item.appendChild(named);
			}
			item.appendChild(chips);
			item.appendChild(createPreview(data.lines));
			if (data.samples.length) {
				const samples = document.createElement("div");
				samples.className = "hokensync-version-diff";
				samples.textContent = `В скобках, например: ${data.samples.join(", ")}`;
				item.appendChild(samples);
			}
			if (diff) {
				const summary = document.createElement("div");
				summary.className = "hokensync-version-diff";
				summary.textContent = describeDifference(card, data, reference, diff);
				item.appendChild(summary);
				if (diff.similar < .3 || diff.hunks.length) {
					const openLabel = diff.similar < .3 ? "Показать, почему тексты разные" : `Показать, что отличается (${diff.hunks.length} ${pluralPlaces(diff.hunks.length)})`;
					const box = createDiffBox(index + 1, data, reference.data, diff);
					const toggle = document.createElement("button");
					toggle.type = "button";
					toggle.className = "hokensync-version-toggle";
					toggle.textContent = openLabel;
					toggle.addEventListener("click", () => {
						box.hidden = !box.hidden;
						toggle.textContent = box.hidden ? openLabel : "Скрыть отличия";
					});
					item.appendChild(toggle);
					item.appendChild(box);
				}
			}
			const actions = document.createElement("div");
			actions.className = "hokensync-version-actions";
			const foundMode = options.mode === "found";
			if (card.synced && !card.current) actions.appendChild(createButton("Использовать как найденный", () => options.onUseAsFound(card), foundMode ? "primary" : ""));
			if (!foundMode && (card.plain.trim() || card.synced)) actions.appendChild(createButton(options.hasText ? "Заменить текст в поле" : "Вставить текст в поле", () => options.onInsert(card.plain)));
			if (!foundMode && card.synced) actions.appendChild(createButton("Загрузить с таймкодами", () => options.onImportSynced(card.synced), "hokensync-edit-text-btn"));
			item.appendChild(actions);
			list.appendChild(item);
		});
		const footer = document.createElement("div");
		footer.id = "hokensync-library-footer";
		footer.appendChild(createButton("Назад", options.onBack));
		wrapper.appendChild(header);
		wrapper.appendChild(list);
		wrapper.appendChild(footer);
		uiState.content.appendChild(wrapper);
	}
	//#endregion
	//#region src/ui/editor.ts
	var foundSaveChain = Promise.resolve();
	function whenFoundSaved() {
		return foundSaveChain;
	}
	function saveEditedFoundLyrics(track) {
		const synced = serializeLrc(uiState.syncLines);
		const plain = uiState.syncLines.filter((line) => !line.isBreak).map((line) => line.text).join("\n");
		foundSaveChain = foundSaveChain.then(() => getCachedLyrics(track.title, track.artist).catch(() => null)).then((cached) => saveCachedLyrics({
			title: track.title,
			artist: track.artist,
			duration: cached?.duration ?? track.duration,
			plainLyrics: plain,
			syncedLyrics: synced,
			foundBy: cached?.foundBy,
			edited: true,
			sections: copySections(),
			coverUrl: track.coverUrl ?? cached?.coverUrl,
			trackId: track.id ?? cached?.trackId,
			original: cached?.original ?? (cached && !cached.edited ? {
				plainLyrics: cached.plainLyrics,
				syncedLyrics: cached.syncedLyrics
			} : void 0)
		})).catch((error) => {
			console.warn("[HokenSync] Не удалось сохранить правку найденного текста:", error);
		});
	}
	function saveCurrentLyrics() {
		const track = uiState.currentTrack;
		if (!track || !uiState.syncLines.length) return;
		if (uiState.editingFound) {
			saveEditedFoundLyrics(track);
			return;
		}
		const existing = getSavedLyrics(track.title, track.artist);
		saveLyrics({
			title: track.title,
			artist: track.artist,
			duration: track.duration,
			lrc: serializeLrc(uiState.syncLines),
			savedAt: Date.now(),
			coverUrl: track.coverUrl ?? existing?.coverUrl,
			album: track.albumName ?? existing?.album,
			sections: copySections(),
			trackId: track.id
		});
		deleteDraft(track.artist, track.title);
	}
	function copySections() {
		return uiState.sections.length ? uiState.sections.map((mark) => ({ ...mark })) : void 0;
	}
	function saveCurrentDraft() {
		const track = uiState.currentTrack;
		if (!track || !uiState.syncLines.length) return;
		if (uiState.currentMode === "sync" || uiState.currentMode === "review" || uiState.currentMode === "review-break") saveDraft({
			title: track.title,
			artist: track.artist,
			duration: track.duration,
			lines: uiState.syncLines.map((line) => ({ ...line })),
			currentIndex: uiState.syncIndex,
			mode: uiState.currentMode,
			reviewIndex: uiState.reviewIndex,
			sections: copySections()
		});
	}
	function showDeleteConfirm(onConfirm, options) {
		if (uiState.deleteConfirmOpen) return;
		uiState.deleteConfirmOpen = true;
		const modal = document.createElement("div");
		uiState.deleteConfirmElement = modal;
		modal.classList.add("hokensync-delete-modal");
		Object.assign(modal.style, {
			position: "fixed",
			inset: "0",
			zIndex: "100000",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: "24px",
			background: "rgba(0, 0, 0, 0.58)",
			backdropFilter: "blur(8px)"
		});
		const card = document.createElement("div");
		card.classList.add("hokensync-delete-modal-card");
		Object.assign(card.style, {
			width: "min(460px, 100%)",
			boxSizing: "border-box",
			padding: "28px 28px 24px",
			borderRadius: "18px",
			background: "#242424",
			border: "1px solid rgba(255, 255, 255, 0.09)",
			boxShadow: "0 18px 60px rgba(0, 0, 0, 0.45)",
			textAlign: "center"
		});
		const face = document.createElement("div");
		Object.assign(face.style, {
			width: "64px",
			height: "64px",
			margin: "0 auto 18px",
			borderRadius: "50%",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			background: "rgba(255, 255, 255, 0.07)",
			border: "1px solid rgba(255, 255, 255, 0.1)",
			color: "#f2f2f2",
			fontSize: "32px",
			fontWeight: "600",
			lineHeight: "1",
			fontVariantNumeric: "tabular-nums",
			boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)"
		});
		const countdownText = document.createElement("span");
		countdownText.className = "hokensync-countdown-text";
		countdownText.textContent = options.icon ?? "🥺";
		face.appendChild(countdownText);
		card.appendChild(face);
		const title = document.createElement("div");
		Object.assign(title.style, {
			marginBottom: "12px",
			color: "#ffffff",
			fontSize: "20px",
			fontWeight: "700"
		});
		title.textContent = options.title;
		card.appendChild(title);
		const description = document.createElement("div");
		Object.assign(description.style, {
			color: "#a9a9a9",
			fontSize: "14px",
			lineHeight: "1.55",
			marginBottom: "24px"
		});
		description.appendChild(document.createTextNode(options.descriptionBefore));
		const highlightedText = document.createElement("span");
		Object.assign(highlightedText.style, {
			color: "#dedede",
			fontWeight: "600"
		});
		highlightedText.textContent = options.highlightedText;
		description.appendChild(highlightedText);
		description.appendChild(document.createTextNode(options.descriptionAfter));
		card.appendChild(description);
		const buttons = document.createElement("div");
		Object.assign(buttons.style, {
			display: "flex",
			gap: "10px",
			justifyContent: "center"
		});
		let countdownTimer = null;
		let countdownRemaining = Math.max(0, Math.floor(options.countdownSeconds ?? 0));
		const closeModal = () => {
			if (countdownTimer !== null) {
				window.clearInterval(countdownTimer);
				countdownTimer = null;
			}
			modal.classList.add("hokensync-modal-closing");
			card.classList.add("hokensync-modal-card-closing");
			window.setTimeout(() => {
				modal.remove();
				if (uiState.deleteConfirmElement === modal) {
					uiState.deleteConfirmElement = null;
					uiState.deleteConfirmOpen = false;
				}
			}, 120);
		};
		const deleteConfirmButton = createButton(options.confirmLabel ?? "Удалить", () => {
			if (deleteConfirmButton.disabled) return;
			closeModal();
			onConfirm();
		}, "danger");
		const cancelButton = createButton("Отмена", closeModal);
		Object.assign(deleteConfirmButton.style, { minWidth: "120px" });
		Object.assign(cancelButton.style, { minWidth: "120px" });
		buttons.appendChild(deleteConfirmButton);
		buttons.appendChild(cancelButton);
		card.appendChild(buttons);
		modal.appendChild(card);
		uiState.overlay?.appendChild(modal);
		const animateCountdownTick = () => {
			countdownText.classList.remove("hokensync-countdown-tick");
			countdownText.offsetWidth;
			countdownText.classList.add("hokensync-countdown-tick");
		};
		const finishCountdown = () => {
			if (countdownTimer !== null) {
				window.clearInterval(countdownTimer);
				countdownTimer = null;
			}
			countdownText.classList.remove("hokensync-countdown-tick");
			countdownText.classList.remove("hokensync-countdown-complete");
			countdownText.textContent = options.icon ?? "🥺";
			countdownText.offsetWidth;
			countdownText.classList.add("hokensync-countdown-complete");
			deleteConfirmButton.disabled = false;
			deleteConfirmButton.classList.add("hokensync-delete-ready");
			deleteConfirmButton.focus();
		};
		modal.addEventListener("click", (event) => {
			if (event.target === modal) closeModal();
		});
		if (countdownRemaining > 0) {
			deleteConfirmButton.disabled = true;
			deleteConfirmButton.classList.remove("hokensync-delete-ready");
			countdownText.textContent = String(countdownRemaining);
			countdownText.classList.remove("hokensync-countdown-complete");
			animateCountdownTick();
			cancelButton.focus();
			countdownTimer = window.setInterval(() => {
				if (!modal.isConnected) {
					if (countdownTimer !== null) {
						window.clearInterval(countdownTimer);
						countdownTimer = null;
					}
					return;
				}
				countdownRemaining -= 1;
				if (countdownRemaining <= 0) {
					finishCountdown();
					return;
				}
				countdownText.textContent = String(countdownRemaining);
				animateCountdownTick();
			}, 1e3);
		} else {
			deleteConfirmButton.disabled = false;
			deleteConfirmButton.focus();
		}
	}
	function renderTextEditor() {
		const content = uiState.content;
		const currentTrack = uiState.currentTrack;
		if (!content || !currentTrack) return;
		if (uiState.editingFound) {
			renderFoundTextEditor();
			return;
		}
		uiState.currentMode = "text";
		setContent();
		const saved = getSavedLyrics(currentTrack.title, currentTrack.artist);
		if (saved && !saved.coverUrl && currentTrack.coverUrl) saveLyrics({
			...saved,
			coverUrl: currentTrack.coverUrl
		});
		let draft = loadDraft(currentTrack.artist, currentTrack.title);
		let draftIsResync = draft?.mode === "resync" || draft?.mode === "resync-review" || draft?.mode === "resync-break";
		if (saved && draft && (draft.mode === "sync" || draft.mode === "review" || draft.mode === "review-break")) {
			deleteDraft(currentTrack.artist, currentTrack.title);
			draft = null;
		}
		if (saved && draftIsResync) {
			deleteDraft(currentTrack.artist, currentTrack.title);
			draft = null;
			draftIsResync = false;
		}
		const draftMode = draft?.mode ?? (draft && draft.currentIndex >= draft.lines.length ? "review" : "sync");
		let statusText = "Вставь обычный текст песни — по одной строке на каждую строку вокала.";
		if (saved && draft) statusText = "Старый текст сохранён. Есть незавершённая версия, которую можно продолжить.";
		else if (saved) {
			const existingSource = getLyricsSource(currentTrack);
			statusText = existingSource === "native" ? "Для этой песни уже сохранён собственный текст. Песня также имеет текст от Яндекс." : existingSource === "lrclib" ? "Для этой песни уже сохранён собственный текст. Песня также имеет текст от PulseSync." : "Для этой песни уже сохранён собственный текст.";
		} else if (draft) statusText = "Найдена незавершённая работа. Её можно продолжить.";
		const status = setStatus(statusText);
		let resume = null;
		if (draft) if (draftMode === "review") {
			const index = Math.max(0, Math.min(draft.reviewIndex ?? 0, draft.lines.length - 1));
			resume = createButton(`Продолжить проверку с ${index + 1}-й строки`, () => {
				uiState.syncLines = draft.lines.map((line) => ({ ...line }));
				uiState.sections = (draft.sections ?? []).map((mark) => ({ ...mark }));
				uiState.syncIndex = Math.min(draft.currentIndex, uiState.syncLines.length);
				uiState.reviewIndex = index;
				uiState.navigation.showReviewScreen(false, false);
			}, "primary");
		} else if (draftMode === "review-break") {
			const index = Math.max(0, Math.min(draft.reviewIndex ?? 0, draft.lines.length - 1));
			resume = createButton(`Продолжить установку проигрыша после ${index + 1}-й строки`, () => {
				uiState.syncLines = draft.lines.map((line) => ({ ...line }));
				uiState.sections = (draft.sections ?? []).map((mark) => ({ ...mark }));
				uiState.syncIndex = Math.min(draft.currentIndex, uiState.syncLines.length);
				uiState.reviewIndex = index;
				uiState.navigation.startBreakForLine(index, "review");
			}, "primary");
		} else resume = createButton(draft.currentIndex < draft.lines.length ? `Продолжить с ${draft.currentIndex + 1}-й строки` : "Продолжить проверку таймкодов", () => {
			uiState.syncLines = draft.lines.map((line) => ({ ...line }));
			uiState.sections = (draft.sections ?? []).map((mark) => ({ ...mark }));
			uiState.syncIndex = Math.min(draft.currentIndex, uiState.syncLines.length);
			if (draft.currentIndex >= draft.lines.length) {
				if (isPlaying()) pause();
				uiState.reviewIndex = Math.max(0, Math.min(draft.reviewIndex ?? 0, uiState.syncLines.length - 1));
				uiState.navigation.showReviewScreen(false, false);
			} else uiState.navigation.showSyncScreen();
		}, "primary");
		if (resume) {
			const resumeBox = document.createElement("div");
			resumeBox.id = "hokensync-resume";
			const resumeActions = document.createElement("div");
			resumeActions.className = "hokensync-resume-actions";
			resume.style.margin = "0";
			const deleteDraftButton = createButton("Удалить черновик", () => {
				deleteDraft(currentTrack.artist, currentTrack.title);
				showToast("Черновик удалён", "delete", "Незавершённая разметка стёрта.");
				renderTextEditor();
			}, "danger");
			resumeActions.appendChild(resume);
			resumeActions.appendChild(deleteDraftButton);
			resumeBox.appendChild(resumeActions);
			content.appendChild(resumeBox);
		}
		const textarea = document.createElement("textarea");
		textarea.id = "hokensync-textarea";
		textarea.placeholder = "Первая строка\nВторая строка\nТретья строка\n...";
		textarea.readOnly = Boolean(saved);
		let refreshHighlight = () => {};
		const draftText = () => sectionsToText(draft.lines.filter((line) => !line.isBreak).map((line) => line.text), draft.sections ?? []);
		textarea.value = draftIsResync ? draftText() : saved ? lrcToDisplayText(saved.lrc, saved.sections ?? []) : draft ? draftText() : loadTextDraft(currentTrack.artist, currentTrack.title);
		if (!saved) textarea.addEventListener("input", () => {
			saveTextDraft(currentTrack.artist, currentTrack.title, textarea.value);
		});
		let textareaScrollTarget = textarea.scrollTop;
		let textareaScrollFrame = 0;
		const animateTextareaScroll = () => {
			const current = textarea.scrollTop;
			const distance = textareaScrollTarget - current;
			if (Math.abs(distance) < .5) {
				textarea.scrollTop = textareaScrollTarget;
				textareaScrollFrame = 0;
				return;
			}
			textarea.scrollTop = current + distance * .18;
			textareaScrollFrame = window.requestAnimationFrame(animateTextareaScroll);
		};
		textarea.addEventListener("wheel", (event) => {
			event.preventDefault();
			event.stopPropagation();
			revealScrollbar(textarea);
			textareaScrollTarget = Math.max(0, Math.min(textarea.scrollHeight - textarea.clientHeight, textareaScrollTarget + event.deltaY));
			if (!textareaScrollFrame) textareaScrollFrame = window.requestAnimationFrame(animateTextareaScroll);
		}, {
			capture: true,
			passive: false
		});
		const buttons = document.createElement("div");
		buttons.id = "hokensync-buttons";
		if (saved) buttons.appendChild(createButton("Изменить таймкоды отдельных строк", () => uiState.navigation.startSavedResync(saved)));
		let startButton = null;
		if (!saved) startButton = createButton("Начать синхронизацию", () => {
			const { lines, sections } = parseLyricsText(textarea.value);
			if (!lines.length) {
				showToast("Нет текста", "error", "Сначала вставь текст песни.");
				return;
			}
			clearTextDraft(currentTrack.artist, currentTrack.title);
			uiState.navigation.startSynchronization(lines, sections);
		}, "primary");
		let formatButton = null;
		if (!saved) {
			formatButton = createButton("Форматирование", () => {
				const before = textarea.value;
				const formatted = formatLyricsText(before);
				if (!formatted) {
					showToast("Нет текста", "error", "Сначала вставь текст песни.");
					return;
				}
				if (formatted === before) {
					showToast("Текст уже в порядке", "info", "Менять нечего.");
					return;
				}
				textarea.value = formatted;
				textarea.dispatchEvent(new Event("input"));
				showToast("Текст отформатирован", "success", "Лишние пробелы и знаки в конце строк убраны, метки на месте.");
			}, "hokensync-find-btn");
			formatButton.innerHTML = `${ICONS.format}<span>Форматирование</span>`;
		}
		let findButton = null;
		if (!saved) {
			findButton = createButton("Найти текст", () => {
				if (!findButton || findButton.disabled) return;
				const button = findButton;
				const hasText = textarea.value.trim().length > 0;
				button.disabled = true;
				status.textContent = "Ищу текст в LRCLIB…";
				Promise.all([findLyricsVariants({
					title: currentTrack.title,
					artist: currentTrack.artist,
					duration: currentTrack.duration
				}), getCachedLyrics(currentTrack.title, currentTrack.artist).catch(() => null)]).then(([variants, cached]) => {
					status.textContent = statusText;
					button.disabled = false;
					const cachedSynced = cached?.syncedLyrics?.trim() ?? "";
					const cachedPlain = cached?.plainLyrics?.trim() ?? "";
					const cards = variants.map((variant) => ({
						plain: variant.plain,
						synced: variant.synced,
						trackName: variant.trackName,
						artistName: variant.artistName,
						duration: variant.duration,
						origin: "LRCLIB",
						confident: variant.confident,
						current: Boolean(cachedSynced) && variant.synced === cachedSynced
					}));
					if ((cachedSynced || cachedPlain) && !cards.some((card) => card.current)) cards.unshift({
						plain: cachedPlain || lrcToPlainText(cachedSynced),
						synced: cachedSynced,
						trackName: cached?.title ?? currentTrack.title,
						artistName: cached?.artist ?? currentTrack.artist,
						duration: cached?.duration,
						origin: cached?.edited ? "найденный текст с твоими правками" : `найден автоматически (${cached?.foundBy === "hokensync" ? "HokenSync" : "PulseSync"})`,
						confident: false,
						current: true
					});
					cards.splice(0, cards.length, ...mergeIdenticalVersions(cards));
					cards.sort((a, b) => Number(b.current) - Number(a.current));
					if (!cards.length) {
						showToast("Текст не найден", "warning", "В LRCLIB этой песни нет. Вставь текст вручную.");
						return;
					}
					if (cards.length > 1) {
						renderVersionsScreen({
							track: currentTrack,
							cards,
							hasText,
							onInsert: (plain) => {
								saveTextDraft(currentTrack.artist, currentTrack.title, formatLyricsText(plain));
								renderTextEditor();
								showToast("Текст вставлен", "success", "Проверь его и поправь перед разметкой.");
							},
							onImportSynced: (synced) => importSyncedLyrics(synced),
							onUseAsFound: (card) => void useVersionAsFound(card, "own"),
							mode: "own",
							onBack: () => renderTextEditor()
						});
						return;
					}
					const found = cards[0];
					const items = [{
						label: `Найдено: ${found.artistName} — ${found.trackName}${found.synced ? " (с таймкодами)" : " (только текст)"}`,
						heading: true,
						onPick: () => {}
					}, {
						label: hasText ? "Заменить текст в поле" : "Вставить текст в поле",
						onPick: () => {
							textarea.value = formatLyricsText(found.plain);
							textarea.dispatchEvent(new Event("input"));
							showToast("Текст вставлен", "success", "Проверь его и поправь перед разметкой.");
						}
					}];
					if (found.synced) items.push({
						label: "Загрузить с готовыми таймкодами",
						onPick: () => importSyncedLyrics(found.synced)
					});
					openChoiceMenu(button, items);
				}).catch((error) => {
					status.textContent = statusText;
					button.disabled = false;
					const serverDown = error instanceof Error && /^LRCLIB 5\d\d$/.test(error.message);
					showToast("Поиск не удался", "error", error instanceof Error && error.message === "LRCLIB 429" ? "LRCLIB ограничил число запросов. Подожди пару минут и попробуй снова." : serverDown ? "Сервер LRCLIB сейчас недоступен. Попробуй позже." : "Нет связи с LRCLIB. Проверь интернет или включи VPN и попробуй ещё раз.");
				});
			}, "hokensync-find-btn");
			findButton.innerHTML = `${ICONS.search}<span>Найти текст</span>`;
		}
		let tagButton = null;
		if (!saved) {
			tagButton = createButton("Метка", () => {
				openChoiceMenu(tagButton, [{
					label: "Вставить метку в место курсора",
					onPick: () => {},
					heading: true
				}, ...SECTION_LABELS.map((label) => ({
					label,
					onPick: () => insertSectionLabel(textarea, label, refreshHighlight, currentTrack)
				}))]);
			}, "hokensync-tag-btn");
			tagButton.innerHTML = `${ICONS.tag}<span>Метка</span>`;
		}
		const deleteButton = createButton("Удалить сохранённый", () => {
			showDeleteConfirm(() => {
				deleteLyrics(currentTrack.artist, currentTrack.title);
				deleteDraft(currentTrack.artist, currentTrack.title);
				refreshCurrentTrackLyrics();
				showToast("Текст удалён", "delete", "Если он ещё виден в плеере, смени трек или перезапусти приложение.");
				renderTextEditor();
			}, {
				title: "Удалить собственный текст?",
				descriptionBefore: "Собственный текст для песни ",
				highlightedText: `${currentTrack.artist || "Неизвестный исполнитель"} — ${currentTrack.title || "Без названия"}`,
				descriptionAfter: " будет удалён из HokenSync.",
				icon: "🥺"
			});
		}, "danger");
		const closeButton = createButton("Назад", () => void uiState.navigation.showLyricsMenu(), "ml-auto");
		if (startButton) buttons.appendChild(startButton);
		if (findButton) buttons.appendChild(findButton);
		if (formatButton) buttons.appendChild(formatButton);
		if (tagButton) buttons.appendChild(tagButton);
		if (saved) buttons.appendChild(deleteButton);
		buttons.appendChild(closeButton);
		const wrap = document.createElement("div");
		wrap.className = "hokensync-textarea-wrap";
		const backdrop = document.createElement("div");
		backdrop.className = "hokensync-textarea-backdrop";
		backdrop.setAttribute("aria-hidden", "true");
		const copyButton = createButton("", () => copyLyricsText(textarea), "hokensync-copy-btn");
		copyButton.innerHTML = ICONS.paperclip;
		copyButton.setAttribute("aria-label", "Копировать текст");
		const syncCopyState = () => {
			copyButton.disabled = !textarea.value.replace(/\u200B/g, "").trim();
		};
		textarea.addEventListener("input", syncCopyState);
		syncCopyState();
		wrap.appendChild(backdrop);
		wrap.appendChild(textarea);
		wrap.appendChild(copyButton);
		refreshHighlight = attachSectionHighlight(textarea, backdrop);
		const sw = takeSwitch();
		content.appendChild(createEditorHead(status, "own", sw?.from));
		content.appendChild(wrap);
		content.appendChild(buttons);
		if (sw) {
			wrap.classList.add(sw.slide);
			buttons.classList.add(sw.slide);
		}
	}
	function insertSectionLabel(textarea, label, refresh, track) {
		const value = textarea.value;
		const caret = textarea.selectionStart ?? value.length;
		const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
		const verseCount = value.split("\n").filter((line) => /^\[\s*Куплет/i.test(line.trim())).length;
		const text = label === "Куплет" ? `Куплет ${verseCount + 1}` : label;
		const before = value.slice(0, lineStart);
		const insert = `${before.length > 0 && !before.endsWith("\n\n") ? "\n" : ""}[${text}]\n`;
		textarea.value = before + insert + value.slice(lineStart);
		const position = before.length + insert.length;
		textarea.focus();
		textarea.setSelectionRange(position, position);
		textarea.dispatchEvent(new Event("input"));
	}
	var pendingSwitch = null;
	function takeSwitch() {
		const current = pendingSwitch;
		pendingSwitch = null;
		return current;
	}
	function playLeave(direction) {
		const content = uiState.content;
		const items = content ? Array.from(content.children).filter((item) => !item.classList.contains("hokensync-editor-head")) : [];
		const finished = [];
		for (const item of items) {
			item.classList.remove("hokensync-slide-from-left", "hokensync-slide-from-right");
			item.classList.add(`hokensync-leave-${direction}`);
			const animations = item.getAnimations?.() ?? [];
			for (const animation of animations) finished.push(animation.finished.catch(() => void 0));
		}
		return Promise.all(finished).then(() => void 0);
	}
	var TAB_ICONS = {
		found: `
        <svg class="hokensync-tab-icon" viewBox="0 0 28 28" aria-hidden="true">
            <path d="M5.5 4.5h9.8l4.2 4.2v3.1"/>
            <path d="M15.3 4.8v4h4"/>
            <path class="hokensync-doc-lines" d="M8.3 12h6.2M8.3 15.5h5M8.3 19h4"/>
            <path class="hokensync-scan-line" d="M7.8 11.3h8.6"/>
            <g class="hokensync-lens">
                <circle cx="17.7" cy="17.4" r="4.05"/>
                <path d="m20.65 20.4 3.05 3.05"/>
                <path d="M17.7 15.7v3.4M16 17.4h3.4" opacity=".8"/>
            </g>
        </svg>
    `,
		own: `
        <svg class="hokensync-tab-icon" viewBox="0 0 28 28" aria-hidden="true">
            <path d="M5.5 4.5h9.8l4.2 4.2v5.1"/>
            <path d="M15.3 4.8v4h4"/>
            <path class="hokensync-doc-lines" d="M8.3 12h5.7M8.3 15.5h4.6M8.3 19h3.5"/>
            <path class="hokensync-write-trace" d="M7.8 22.3h6.8"/>
            <g class="hokensync-pen">
                <path d="m14.6 20.2 6.5-6.5a1.7 1.7 0 0 1 2.4 2.4L17 22.6l-3.3.9z"/>
                <path d="m19.9 14.9 2.4 2.4"/>
                <path d="m14.6 20.2 3.3 2.4"/>
            </g>
        </svg>
    `
	};
	function createEditorTabs(active, from) {
		const tabs = document.createElement("div");
		tabs.className = "hokensync-tabs";
		tabs.setAttribute("role", "tablist");
		let switching = false;
		const play = (tab) => {
			tab.classList.remove("playing");
			tab.offsetWidth;
			tab.classList.add("playing");
		};
		const make = (label, key, open) => {
			const tab = document.createElement("button");
			const text = document.createElement("span");
			tab.type = "button";
			tab.className = key === (from ?? active) ? "hokensync-tab active" : "hokensync-tab";
			tab.dataset.tab = key;
			tab.setAttribute("role", "tab");
			tab.setAttribute("aria-selected", String(key === active));
			tab.innerHTML = TAB_ICONS[key];
			text.className = "hokensync-tab-label";
			text.textContent = label;
			tab.appendChild(text);
			tab.addEventListener("animationend", () => tab.classList.remove("playing"));
			if (key !== active) tab.addEventListener("click", () => {
				if (switching) return;
				switching = true;
				const toFound = key === "found";
				playLeave(toFound ? "left" : "right").then(() => {
					if (!tabs.isConnected) return;
					if (key === "own") uiState.editingFound = false;
					pendingSwitch = {
						from: active,
						slide: toFound ? "hokensync-slide-from-right" : "hokensync-slide-from-left"
					};
					open();
				});
			});
			else tab.addEventListener("mouseenter", () => play(tab));
			return tab;
		};
		const buttons = {
			own: make("Свой текст", "own", () => renderTextEditor()),
			found: make("Найденный текст", "found", () => renderFoundTextEditor())
		};
		tabs.appendChild(buttons.own);
		tabs.appendChild(buttons.found);
		if (from && from !== active) window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				if (!tabs.isConnected) return;
				buttons[from].classList.remove("active");
				buttons[active].classList.add("active");
				play(buttons[active]);
			});
		});
		return tabs;
	}
	function createEditorHead(status, active, from) {
		const head = document.createElement("div");
		head.className = "hokensync-editor-head";
		head.appendChild(status);
		head.appendChild(createEditorTabs(active, from));
		return head;
	}
	function renderFoundTextEditor() {
		const content = uiState.content;
		const track = uiState.currentTrack;
		if (!content || !track) return;
		uiState.currentMode = "text";
		setContent();
		const sw = takeSwitch();
		const status = setStatus("");
		const head = createEditorHead(status, "found", sw?.from);
		content.appendChild(head);
		whenFoundSaved().then(() => getCachedLyrics(track.title, track.artist)).catch(() => null).then((cached) => {
			if (!head.isConnected) return;
			const synced = cached?.syncedLyrics?.trim() ?? "";
			const plain = cached?.plainLyrics?.trim() ?? "";
			const hasText = Boolean(synced || plain);
			const saved = getSavedLyrics(track.title, track.artist);
			const source = cached?.foundBy === "hokensync" ? "HokenSync" : "PulseSync";
			let statusText = "Автоматически найденного текста пока нет. PulseSync или HokenSync подставят его сами, когда найдут.";
			if (hasText) {
				statusText = `Текст добавлен автоматически (${source}), ${synced ? "с таймкодами" : "только текст, без таймкодов"}.`;
				if (cached?.edited) statusText += " Ты его менял.";
				if (saved) statusText += " У песни есть свой текст, он показывается вместо найденного.";
			}
			status.textContent = statusText;
			if (hasText && saved?.fromFound) {
				const restoreFound = async () => {
					const current = getSavedLyrics(track.title, track.artist);
					if (!current) {
						renderFoundTextEditor();
						return;
					}
					try {
						const changed = Boolean(cached?.edited) || current.lrc.trim() !== synced;
						await saveCachedLyrics({
							title: track.title,
							artist: track.artist,
							duration: cached?.duration ?? track.duration,
							plainLyrics: changed ? lrcToPlainText(current.lrc) : plain,
							syncedLyrics: current.lrc,
							foundBy: cached?.foundBy,
							edited: changed,
							sections: current.sections,
							coverUrl: current.coverUrl ?? cached?.coverUrl,
							trackId: track.id ?? cached?.trackId ?? current.trackId,
							original: cached?.original ?? (cached && !cached.edited ? {
								plainLyrics: cached.plainLyrics,
								syncedLyrics: cached.syncedLyrics
							} : void 0)
						});
						deleteLyrics(current.artist, current.title);
						refreshCurrentTrackLyrics();
						showToast("Текст снова найденный", "success", "Свой текст убран, текст вернулся на вкладку «Найденный текст».");
						renderFoundTextEditor();
					} catch (error) {
						console.warn("[HokenSync] Не удалось вернуть текст в найденные:", error);
						showToast("Не удалось вернуть", "error", "Свой текст остался как есть.");
					}
				};
				const convertedWrap = document.createElement("div");
				const convertedBackdrop = document.createElement("div");
				const note = document.createElement("div");
				const noteTitle = document.createElement("div");
				const noteText = document.createElement("div");
				status.textContent = "Найденный текст переделан в свой.";
				convertedWrap.className = sw ? `hokensync-textarea-wrap ${sw.slide}` : "hokensync-textarea-wrap";
				convertedBackdrop.className = "hokensync-textarea-backdrop";
				convertedBackdrop.setAttribute("aria-hidden", "true");
				note.className = "hokensync-converted-note";
				noteTitle.className = "hokensync-converted-title";
				noteTitle.textContent = "Найденный текст переделан в свой";
				noteText.className = "hokensync-converted-text";
				noteText.textContent = "Он теперь на вкладке «Свой текст», здесь его не показываем. Кнопка ниже вернёт его сюда как найденный.";
				note.appendChild(noteTitle);
				note.appendChild(noteText);
				convertedWrap.appendChild(convertedBackdrop);
				convertedWrap.appendChild(note);
				content.appendChild(convertedWrap);
				const convertedButtons = document.createElement("div");
				convertedButtons.id = "hokensync-buttons";
				convertedButtons.appendChild(createButton("Вернуть как найденный", () => void restoreFound(), "hokensync-edit-text-btn"));
				convertedButtons.appendChild(createButton("Назад", () => void uiState.navigation.showLyricsMenu(), "ml-auto"));
				if (sw) convertedButtons.classList.add(sw.slide);
				content.appendChild(convertedButtons);
				return;
			}
			if (hasText) {
				const wrap = document.createElement("div");
				wrap.className = sw ? `hokensync-textarea-wrap ${sw.slide}` : "hokensync-textarea-wrap";
				const backdrop = document.createElement("div");
				backdrop.className = "hokensync-textarea-backdrop";
				backdrop.setAttribute("aria-hidden", "true");
				const textarea = document.createElement("textarea");
				textarea.id = "hokensync-textarea";
				textarea.readOnly = true;
				textarea.value = synced ? lrcToDisplayText(synced, cached?.sections ?? []) : plain;
				const copyButton = createButton("", () => copyLyricsText(textarea), "hokensync-copy-btn");
				copyButton.innerHTML = ICONS.paperclip;
				copyButton.setAttribute("aria-label", "Копировать текст");
				wrap.appendChild(backdrop);
				wrap.appendChild(textarea);
				wrap.appendChild(copyButton);
				attachSectionHighlight(textarea, backdrop);
				content.appendChild(wrap);
			} else {
				const emptyWrap = document.createElement("div");
				const emptyBackdrop = document.createElement("div");
				emptyWrap.className = sw ? `hokensync-textarea-wrap ${sw.slide}` : "hokensync-textarea-wrap";
				emptyBackdrop.className = "hokensync-textarea-backdrop";
				emptyBackdrop.setAttribute("aria-hidden", "true");
				emptyWrap.appendChild(emptyBackdrop);
				content.appendChild(emptyWrap);
			}
			const buttons = document.createElement("div");
			buttons.id = "hokensync-buttons";
			if (synced) buttons.appendChild(createButton("Изменить таймкоды отдельных строк", () => {
				uiState.editingFound = true;
				uiState.navigation.startSavedResync({
					title: track.title,
					artist: track.artist,
					duration: track.duration,
					lrc: synced,
					savedAt: cached?.savedAt ?? Date.now(),
					sections: cached?.sections
				});
			}, "primary"));
			else if (plain) buttons.appendChild(createButton("Разметить таймкоды", () => {
				if (loadTextDraft(track.artist, track.title).trim()) {
					showToast("Поле «Свой текст» не пустое", "warning", "Очисти его, чтобы вставить найденный текст.");
					return;
				}
				saveTextDraft(track.artist, track.title, formatLyricsText(plain));
				renderTextEditor();
			}, "primary"));
			const openVersions = () => {
				status.textContent = "Ищу версии в LRCLIB…";
				collectVersionCards(track).then((cards) => {
					if (!cards.length) {
						showToast("Версий нет", "warning", "В LRCLIB этой песни нет.");
						return;
					}
					renderVersionsScreen({
						track,
						cards,
						hasText: false,
						mode: "found",
						onInsert: () => void 0,
						onImportSynced: () => void 0,
						onUseAsFound: (card) => void useVersionAsFound(card, "found"),
						onBack: () => renderFoundTextEditor()
					});
				}).catch((error) => {
					console.warn("[HokenSync] Не удалось загрузить версии текста:", error);
					showToast("Версии не загрузились", "error", "LRCLIB сейчас недоступен. Попробуй позже.");
				}).finally(() => {
					status.textContent = statusText;
				});
			};
			const convertToOwn = () => {
				saveLyrics({
					title: track.title,
					artist: track.artist,
					duration: track.duration,
					lrc: synced,
					savedAt: Date.now(),
					coverUrl: track.coverUrl ?? cached?.coverUrl,
					album: track.albumName,
					sections: cached?.sections,
					fromFound: true,
					trackId: track.id
				});
				refreshCurrentTrackLyrics();
				uiState.editingFound = false;
				showToast("Текст стал своим", "success", "Теперь его можно править на вкладке «Свой текст». Вернуть его в найденные можно на вкладке «Найденный текст».");
				renderTextEditor();
			};
			const askConvert = () => {
				if (getSavedLyrics(track.title, track.artist)) {
					showDeleteConfirm(convertToOwn, {
						title: "Заменить свой текст?",
						descriptionBefore: "У песни уже есть свой текст. Он будет ",
						highlightedText: "заменён найденным",
						descriptionAfter: ". Отменить это будет нельзя.",
						icon: "↔",
						confirmLabel: "Заменить"
					});
					return;
				}
				convertToOwn();
			};
			const askReset = () => {
				showDeleteConfirm(async () => {
					try {
						await foundSaveChain;
						const result = await resetEditedLyrics(track.title, track.artist);
						refreshCurrentTrackLyrics();
						if (result === "removed") showToast("Правки сброшены", "info", "Первоначальный вид не сохранился: текст удалён и найдётся заново.");
						else showToast("Правки сброшены", "success", "Текст вернулся к первоначальному виду.");
						const current = uiState.currentTrack;
						if (current && current.title === track.title && current.artist === track.artist) renderFoundTextEditor();
					} catch (error) {
						console.warn("[HokenSync] Не удалось сбросить правки найденного текста:", error);
						showToast("Не удалось сбросить", "error", "Правки остались как есть.");
					}
				}, {
					title: "Сбросить правки?",
					descriptionBefore: "Таймкоды, строки и метки, которые ты менял, вернутся к ",
					highlightedText: "первоначальному виду",
					descriptionAfter: ". Отменить это будет нельзя.",
					icon: "↩",
					confirmLabel: "Сбросить"
				});
			};
			const iconVersions = "<path class=\"hs-mi-back\" d=\"M9 7V5.7a2.2 2.2 0 0 1 2.2-2.2h6.6A2.2 2.2 0 0 1 20 5.7v8.6a2.2 2.2 0 0 1-2.2 2.2H15\"/><rect class=\"hs-mi-front\" x=\"4\" y=\"7\" width=\"11\" height=\"14\" rx=\"2.2\"/>";
			const iconConvert = "<path d=\"M11.5 20.5H5.5v-17h8L17 7v3.5\"/><path d=\"M13.5 3.5V7H17\"/><path class=\"hs-mi-line\" d=\"M8.5 11h5M8.5 14.5h3\"/><g class=\"hs-mi-pen\"><path d=\"m13.2 20.3.7-2.7 5.6-5.6a1.4 1.4 0 0 1 2 2l-5.6 5.6z\"/><path d=\"m17.8 13.8 2 2\"/></g>";
			const iconReset = "<g class=\"hs-mi-undo\"><path d=\"M4 12a8 8 0 1 0 2.5-5.8\"/><path d=\"M4 4.2v4.6h4.6\"/></g>";
			const moreItems = [{
				label: "Выбрать другую версию",
				icon: iconVersions,
				onPick: openVersions
			}];
			if (synced) moreItems.push({
				label: "Превратить в свой текст",
				icon: iconConvert,
				onPick: askConvert
			});
			if (cached?.edited) moreItems.push({
				label: "Сбросить правки",
				icon: iconReset,
				danger: true,
				separator: true,
				onPick: askReset
			});
			const moreButton = createButton("", () => openChoiceMenu(moreButton, moreItems), "hokensync-more-btn");
			moreButton.title = "Ещё действия";
			moreButton.setAttribute("aria-label", "Ещё действия");
			moreButton.innerHTML = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"5\" cy=\"12\" r=\"1.7\"/><circle cx=\"12\" cy=\"12\" r=\"1.7\"/><circle cx=\"19\" cy=\"12\" r=\"1.7\"/></svg>";
			buttons.appendChild(moreButton);
			buttons.appendChild(createButton("Назад", () => void uiState.navigation.showLyricsMenu(), "ml-auto"));
			if (sw) buttons.classList.add(sw.slide);
			content.appendChild(buttons);
		});
	}
	async function collectVersionCards(track) {
		const [variants, cached] = await Promise.all([findLyricsVariants({
			title: track.title,
			artist: track.artist,
			duration: track.duration
		}), getCachedLyrics(track.title, track.artist).catch(() => null)]);
		const cachedSynced = cached?.syncedLyrics?.trim() ?? "";
		const cachedPlain = cached?.plainLyrics?.trim() ?? "";
		const cards = variants.map((variant) => ({
			plain: variant.plain,
			synced: variant.synced,
			trackName: variant.trackName,
			artistName: variant.artistName,
			duration: variant.duration,
			origin: "LRCLIB",
			confident: variant.confident,
			current: Boolean(cachedSynced) && variant.synced === cachedSynced
		}));
		if ((cachedSynced || cachedPlain) && !cards.some((card) => card.current)) cards.unshift({
			plain: cachedPlain || lrcToPlainText(cachedSynced),
			synced: cachedSynced,
			trackName: cached?.title ?? track.title,
			artistName: cached?.artist ?? track.artist,
			duration: cached?.duration,
			origin: cached?.edited ? "найденный текст с твоими правками или выбором" : `найден автоматически (${cached?.foundBy === "hokensync" ? "HokenSync" : "PulseSync"})`,
			confident: false,
			current: true
		});
		cards.splice(0, cards.length, ...mergeIdenticalVersions(cards));
		cards.sort((a, b) => Number(b.current) - Number(a.current));
		return cards;
	}
	async function useVersionAsFound(card, from) {
		const track = uiState.currentTrack;
		if (!track || !card.synced) return;
		try {
			await whenFoundSaved();
			const cached = await getCachedLyrics(track.title, track.artist);
			await saveCachedLyrics({
				title: track.title,
				artist: track.artist,
				duration: card.duration ?? track.duration,
				plainLyrics: card.plain.trim() || lrcToPlainText(card.synced),
				syncedLyrics: card.synced,
				foundBy: "hokensync",
				edited: true,
				coverUrl: track.coverUrl ?? cached?.coverUrl,
				trackId: track.id ?? cached?.trackId,
				original: cached?.original ?? (cached && !cached.edited ? {
					plainLyrics: cached.plainLyrics,
					syncedLyrics: cached.syncedLyrics
				} : void 0)
			});
			refreshCurrentTrackLyrics();
			showToast("Версия выбрана", "success", "Теперь плеер использует эту версию как найденный текст.");
		} catch (error) {
			console.warn("[HokenSync] Не удалось выбрать версию как найденную:", error);
			showToast("Не удалось выбрать версию", "error", "Найденный текст остался прежним.");
			return;
		}
		if (from === "found") renderFoundTextEditor();
		else renderTextEditor();
	}
	function importSyncedLyrics(synced) {
		const lines = parseLrc(synced).map((line) => ({ ...line }));
		if (!lines.some((line) => !line.isBreak)) {
			showToast("Нет строк текста", "error", "В найденной синхронизации нечего загружать.");
			return;
		}
		uiState.syncLines = lines;
		uiState.sections = [];
		finishLyrics();
	}
	function copyLyricsText(textarea) {
		const text = textarea.value.replace(/\u200B/g, "");
		if (!text.trim()) {
			showToast("Нечего копировать", "warning", "Поле с текстом пустое.");
			return;
		}
		const done = () => {
			showToast("Текст скопирован", "success", "В ваш буфер успешно скопирован текст песни с метками.");
		};
		const fallback = () => {
			const copy = document.createElement("textarea");
			copy.value = text;
			copy.style.position = "fixed";
			copy.style.opacity = "0";
			document.body.appendChild(copy);
			copy.select();
			try {
				document.execCommand("copy");
				done();
			} catch {
				showToast("Не удалось скопировать", "error", "Выдели текст и скопируй вручную.");
			} finally {
				copy.remove();
			}
		};
		if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
		else fallback();
	}
	function finishLyrics() {
		if (!uiState.currentTrack) return;
		const track = uiState.currentTrack;
		const lrc = serializeLrc(uiState.syncLines);
		const existing = getSavedLyrics(track.title, track.artist);
		saveLyrics({
			title: track.title,
			artist: track.artist,
			duration: track.duration,
			lrc,
			savedAt: Date.now(),
			coverUrl: track.coverUrl ?? existing?.coverUrl,
			album: track.albumName ?? existing?.album,
			sections: copySections(),
			trackId: track.id
		});
		refreshCurrentTrackLyrics();
		clearTextDraft(track.artist, track.title);
		showToast("Текст добавлен", "success", "Он уже доступен или появится после смены трека или перезапуска.");
		deleteDraft(track.artist, track.title);
		renderDoneScreen(lrc);
	}
	function renderDoneScreen(lrc) {
		if (!uiState.content) return;
		uiState.currentMode = "done";
		setContent();
		const wrapper = document.createElement("div");
		wrapper.id = "hokensync-done";
		const inner = document.createElement("div");
		inner.id = "hokensync-done-inner";
		const title = document.createElement("div");
		title.id = "hokensync-done-title";
		title.textContent = "Готово";
		const description = document.createElement("div");
		description.id = "hokensync-done-text";
		description.textContent = "Текст для этой песни добавлен и сохранён. Теперь HokenSync сможет подставлять его в функциональном меню текста песни.";
		const preview = document.createElement("div");
		preview.id = "hokensync-preview";
		preview.textContent = lrc;
		const buttons = document.createElement("div");
		buttons.id = "hokensync-buttons";
		buttons.appendChild(createButton("Закрыть", () => uiState.navigation.closeEditor(), "primary ml-auto"));
		inner.appendChild(title);
		inner.appendChild(description);
		inner.appendChild(preview);
		inner.appendChild(buttons);
		wrapper.appendChild(inner);
		uiState.content.appendChild(wrapper);
	}
	//#endregion
	//#region src/ui/saved-texts.ts
	function sanitizeFileName(value) {
		return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/g, "").trim() || "lyrics";
	}
	async function saveTextFile(fileName, content, description, mime, extension, onProgress) {
		try {
			const showSaveFilePicker = window.showSaveFilePicker;
			if (showSaveFilePicker) {
				const handle = await showSaveFilePicker({
					suggestedName: fileName,
					types: [{
						description,
						accept: { [mime]: [extension] }
					}]
				});
				onProgress?.(.3);
				const writable = await handle.createWritable();
				onProgress?.(.55);
				await writable.write(content);
				onProgress?.(.85);
				await writable.close();
				onProgress?.(1);
				return true;
			}
			onProgress?.(.4);
			const blob = new Blob([content], { type: `${mime};charset=utf-8` });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = fileName;
			link.style.display = "none";
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 1e3);
			onProgress?.(1);
			return true;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return false;
			console.error("[HokenSync] Не удалось сохранить файл:", error);
			showToast("Не удалось сохранить файл", "error", "Попробуй ещё раз или выбери другую папку.");
			return false;
		}
	}
	async function downloadLrc(saved) {
		const fileName = `${sanitizeFileName(saved.artist)} - ${sanitizeFileName(saved.title)}.lrc`;
		let banner = null;
		const done = await saveTextFile(fileName, saved.lrc, "LRC файл", "text/plain", ".lrc", (progress) => {
			if (!banner) {
				banner = showBanner({
					title: "Сохраняю LRC…",
					description: fileName,
					icon: ICONS.download,
					tone: "info",
					progress
				});
				return;
			}
			banner.update({ progress });
		});
		if (!banner) return;
		if (done) {
			await new Promise((resolve) => window.setTimeout(resolve, 950));
			banner.update({
				title: "LRC сохранён",
				icon: ICONS.check,
				tone: "success",
				progress: 1
			});
			banner.close(1500);
		} else banner.close();
	}
	async function exportBackup() {
		const backup = createBackup();
		if (!backup.count) {
			showToast("Нечего сохранять", "warning", "Своих текстов пока нет.");
			return;
		}
		if (await saveTextFile(backup.fileName, backup.content, "Резервная копия HokenSync", "application/json", ".json")) showToast("Копия сохранена", "success", `Текстов в файле: ${backup.count}. Храни его в надёжном месте.`);
	}
	function importBackup() {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json,application/json";
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (!file) return;
			file.text().then((content) => {
				try {
					const result = restoreBackup(content);
					showToast("Копия загружена", "success", `Добавлено: ${result.added}, обновлено: ${result.updated}, пропущено: ${result.skipped}.`);
					renderSavedLyricsList();
				} catch (error) {
					showToast("Не удалось загрузить", "error", error instanceof Error ? error.message : "Файл повреждён.");
				}
			});
		});
		input.click();
	}
	var libraryFilter = "own";
	function renderSavedLyricsList() {
		if (!uiState.content) return;
		uiState.currentMode = "text";
		setContent();
		const ownLyrics = getAllSavedLyrics().map((saved) => ({
			...saved,
			found: false
		}));
		let foundLyrics = [];
		let foundLoaded = false;
		const currentEntries = () => {
			if (libraryFilter === "own") return ownLyrics;
			if (libraryFilter === "found") return foundLyrics;
			return [...ownLyrics, ...foundLyrics].sort((a, b) => b.savedAt - a.savedAt);
		};
		const wrapper = document.createElement("div");
		wrapper.id = "hokensync-library";
		const header = document.createElement("div");
		header.id = "hokensync-library-header";
		const headerIcon = document.createElement("div");
		headerIcon.className = "hokensync-library-header-icon";
		headerIcon.textContent = "♫";
		const headerText = document.createElement("div");
		headerText.className = "hokensync-library-header-text";
		const title = document.createElement("div");
		title.className = "hokensync-library-title";
		title.textContent = "Мои тексты";
		const description = document.createElement("div");
		description.className = "hokensync-library-description";
		headerText.appendChild(title);
		headerText.appendChild(description);
		const count = document.createElement("div");
		count.className = "hokensync-library-count";
		const updateHeader = () => {
			const total = currentEntries().length;
			description.textContent = libraryFilter === "own" ? "Тексты, которые ты добавил вручную" : libraryFilter === "found" ? "Найденные тексты, которые ты правил" : "Твои тексты и найденные, которые ты правил";
			count.textContent = `${total} ${total === 1 ? "текст" : total < 5 ? "текста" : "текстов"}`;
		};
		updateHeader();
		header.appendChild(headerIcon);
		header.appendChild(headerText);
		header.appendChild(count);
		const searchWrapper = document.createElement("div");
		searchWrapper.className = "hokensync-library-search";
		const searchIcon = document.createElement("span");
		searchIcon.className = "hokensync-library-search-icon";
		searchIcon.innerHTML = `
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="M16 16L21 21"></path>
        </svg>
    `;
		const searchInput = document.createElement("input");
		searchInput.type = "text";
		searchInput.placeholder = "Поиск по названию или исполнителю";
		searchInput.autocomplete = "off";
		searchInput.spellcheck = false;
		searchWrapper.appendChild(searchIcon);
		searchWrapper.appendChild(searchInput);
		const list = document.createElement("div");
		list.id = "hokensync-saved-lyrics-list";
		const empty = document.createElement("div");
		empty.className = "hokensync-library-empty";
		const renderList = (query = "") => {
			list.innerHTML = "";
			const entries = currentEntries();
			const normalizedQuery = query.trim().toLocaleLowerCase();
			const filtered = entries.filter((saved) => {
				if (!normalizedQuery) return true;
				return saved.title.toLocaleLowerCase().includes(normalizedQuery) || saved.artist.toLocaleLowerCase().includes(normalizedQuery);
			});
			if (!filtered.length) {
				if (entries.length) empty.textContent = "По этому запросу ничего не найдено.";
				else if (!foundLoaded && libraryFilter !== "own") empty.textContent = "Загружаю найденные тексты…";
				else if (libraryFilter === "found") empty.textContent = "Правленых найденных текстов пока нет.";
				else if (libraryFilter === "all") empty.textContent = "Пока нет ни своих, ни правленых найденных текстов.";
				else empty.textContent = "Пока нет сохранённых собственных текстов.";
				list.appendChild(empty);
				return;
			}
			for (const saved of filtered) {
				const row = document.createElement("div");
				row.className = saved.found ? "hokensync-saved-lyrics-row hokensync-saved-found" : "hokensync-saved-lyrics-row";
				const icon = document.createElement("div");
				icon.className = "hokensync-saved-lyrics-icon";
				if (saved.coverUrl) {
					const cover = document.createElement("img");
					cover.src = saved.coverUrl;
					cover.alt = "";
					cover.loading = "lazy";
					cover.decoding = "async";
					icon.appendChild(cover);
					cover.addEventListener("error", () => {
						icon.innerHTML = "";
						icon.textContent = "♪";
						icon.classList.add("hokensync-cover-fallback");
					}, { once: true });
				} else icon.textContent = "♪";
				const info = document.createElement("div");
				info.className = "hokensync-saved-lyrics-info";
				const trackTitle = document.createElement("div");
				trackTitle.className = "hokensync-saved-lyrics-title";
				trackTitle.textContent = saved.title;
				const artist = document.createElement("div");
				artist.className = "hokensync-saved-lyrics-artist";
				artist.textContent = (saved.artist || "Неизвестный исполнитель") + (saved.found ? ` · найден ${saved.foundBy ?? "PulseSync"}` : "");
				info.appendChild(trackTitle);
				info.appendChild(artist);
				const downloadButton = createButton("", () => {
					downloadLrc(saved);
				});
				downloadButton.classList.add("hokensync-saved-lyrics-download");
				downloadButton.title = "Скачать LRC";
				downloadButton.setAttribute("aria-label", `Скачать LRC: ${saved.title}`);
				downloadButton.innerHTML = `
                <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path d="M12 4v11"></path>
                    <path d="M7.5 11.5L12 16l4.5-4.5"></path>
                    <path d="M5 20h14"></path>
                </svg>
            `;
				const deleteButton = createButton("", () => askDelete(saved));
				deleteButton.classList.add("hokensync-saved-lyrics-delete");
				deleteButton.title = "Удалить текст";
				deleteButton.setAttribute("aria-label", `Удалить текст: ${saved.title}`);
				deleteButton.innerHTML = `
                <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path d="M5 7h14"></path>
                    <path d="M9.5 7V4.8h5V7"></path>
                    <path d="M6.6 7l.9 11.4a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8L17.4 7"></path>
                    <path d="M10.2 11v5.2M13.8 11v5.2"></path>
                </svg>
            `;
				row.appendChild(icon);
				row.appendChild(info);
				row.appendChild(downloadButton);
				row.appendChild(deleteButton);
				if (saved.trackId) row.classList.add("hokensync-saved-playable");
				row.addEventListener("click", (event) => {
					if (event.target instanceof Element && event.target.closest(".hokensync-btn")) return;
					if (!saved.trackId) {
						showToast("Песню пока не включить", "info", "Для этого текста ещё не известен id песни. Открой HokenSync на ней в плеере один раз, и она станет доступна здесь.");
						return;
					}
					if (playTrackById(saved.trackId)) showToast("Включаю песню", "info", `${saved.artist || "Неизвестный исполнитель"} — ${saved.title}`);
					else showToast("Не удалось включить", "error", "Плеер не принял команду.");
				});
				list.appendChild(row);
			}
		};
		searchInput.addEventListener("input", () => {
			renderList(searchInput.value);
		});
		const filterBar = document.createElement("div");
		filterBar.className = "hokensync-navtab";
		filterBar.setAttribute("role", "tablist");
		const filterLine = document.createElement("span");
		filterLine.className = "hokensync-navtab__line";
		filterBar.appendChild(filterLine);
		const filterOptions = [
			{
				key: "own",
				label: "Свои",
				icon: "<path class=\"hs-nt-doc\" d=\"M4 3.5h9l3.5 3.5v13H4z\"/><path class=\"hs-nt-doc\" d=\"M13 3.5V7h3.5\"/><path class=\"hs-nt-l1\" pathLength=\"1\" d=\"M7 10h6\"/><path class=\"hs-nt-l2\" pathLength=\"1\" d=\"M7 13h4.5\"/><path class=\"hs-nt-l3\" pathLength=\"1\" d=\"M7 16.5h8\"/><g class=\"hs-nt-pen-move\"><g class=\"hs-nt-pen\"><path class=\"hs-nt-pen-body\" d=\"M7 16.5l1-3.2 6.8-6.8a1.6 1.6 0 0 1 2.3 2.3L10.3 15.6z\"/><path d=\"m13 8.3 2.3 2.3\"/></g></g><circle class=\"hs-nt-ink hs-nt-ink1\" cx=\"17.2\" cy=\"18\" r=\".7\"/><circle class=\"hs-nt-ink hs-nt-ink2\" cx=\"18.6\" cy=\"16.2\" r=\".55\"/><circle class=\"hs-nt-ink hs-nt-ink3\" cx=\"16.6\" cy=\"19.8\" r=\".5\"/>"
			},
			{
				key: "found",
				label: "Найденные",
				icon: "<path class=\"hs-nt-doc\" d=\"M4 3.5h9l3.5 3.5v13H4z\"/><path class=\"hs-nt-doc\" d=\"M13 3.5V7h3.5\"/><path class=\"hs-nt-fl1\" d=\"M7 10h6\"/><path class=\"hs-nt-fl2\" d=\"M7 13h4.5\"/><path class=\"hs-nt-fl3\" d=\"M7 16.5h5.5\"/><g class=\"hs-nt-lens-move\"><circle class=\"hs-nt-ring\" cx=\"16\" cy=\"16\" r=\"3.6\"/><g class=\"hs-nt-lens\"><circle class=\"hs-nt-lens-glass\" cx=\"16\" cy=\"16\" r=\"3.6\"/><path d=\"m18.6 18.6 3 3\"/></g></g><path class=\"hs-nt-spark hs-nt-sparkA\" d=\"M20.5 4.8v2.4M19.3 6h2.4\"/><path class=\"hs-nt-spark hs-nt-sparkB\" d=\"M21.5 10.5v1.6M20.7 11.3h1.6\"/>"
			},
			{
				key: "all",
				label: "Все",
				icon: "<g class=\"hs-nt-list\"><circle class=\"hs-nt-b hs-nt-b1\" cx=\"5.5\" cy=\"6.5\" r=\"1.1\"/><circle class=\"hs-nt-b hs-nt-b2\" cx=\"5.5\" cy=\"12\" r=\"1.1\"/><circle class=\"hs-nt-b hs-nt-b3\" cx=\"5.5\" cy=\"17.5\" r=\"1.1\"/><path class=\"hs-nt-row hs-nt-row1\" pathLength=\"1\" d=\"M9 6.5h9\"/><path class=\"hs-nt-row hs-nt-row2\" pathLength=\"1\" d=\"M9 12h7\"/><path class=\"hs-nt-row hs-nt-row3\" pathLength=\"1\" d=\"M9 17.5h8.5\"/></g><path class=\"hs-nt-track\" d=\"M21.5 4.5v15\"/><path class=\"hs-nt-thumb\" d=\"M21.5 5v5\"/>"
			}
		];
		const filterItems = [];
		const ICON_WIDTH = 20;
		const LABEL_GAP = 9;
		const BADGE_GAP = 7;
		let lineReady = false;
		const positionLine = () => {
			const index = filterItems.findIndex((item) => item.key === libraryFilter);
			const item = filterItems[index];
			const inner = filterBar.clientWidth;
			if (!item || !inner) return;
			const grow = parseFloat(getComputedStyle(filterBar).getPropertyValue("--nt-grow")) || 2.7;
			const total = filterItems.length - 1 + grow;
			const tabLeft = inner * index / total;
			const tabWidth = inner * grow / total;
			const labelWidth = item.label.offsetWidth;
			const badgeWidth = item.badge.offsetWidth ? item.badge.offsetWidth + BADGE_GAP : 0;
			const left = tabLeft + (tabWidth - (ICON_WIDTH + LABEL_GAP + labelWidth + badgeWidth)) / 2 + ICON_WIDTH + LABEL_GAP;
			if (!lineReady) filterLine.style.transition = "none";
			filterLine.style.left = `${left}px`;
			filterLine.style.width = `${labelWidth}px`;
			if (!lineReady) {
				filterLine.offsetWidth;
				filterLine.style.transition = "";
				lineReady = true;
			}
		};
		const updateFilter = () => {
			const counts = {
				own: ownLyrics.length,
				found: foundLyrics.length,
				all: ownLyrics.length + foundLyrics.length
			};
			filterBar.dataset.filter = libraryFilter;
			for (const item of filterItems) {
				item.button.classList.toggle("active", item.key === libraryFilter);
				item.button.setAttribute("aria-selected", String(item.key === libraryFilter));
				item.badge.textContent = item.key === "own" || foundLoaded ? String(counts[item.key]) : "";
			}
			positionLine();
		};
		const refresh = () => {
			updateFilter();
			updateHeader();
			renderList(searchInput.value);
		};
		function askDelete(saved) {
			const name = `${saved.artist || "Неизвестный исполнитель"} — ${saved.title || "Без названия"}`;
			showDeleteConfirm(async () => {
				try {
					if (saved.found) {
						await deleteCachedLyrics(saved.title, saved.artist);
						forgetResolvedSyncLyrics(saved.title, saved.artist);
						foundLyrics = foundLyrics.filter((item) => item !== saved);
					} else {
						deleteLyrics(saved.artist, saved.title);
						deleteDraft(saved.artist, saved.title);
						const index = ownLyrics.indexOf(saved);
						if (index >= 0) ownLyrics.splice(index, 1);
					}
					refreshCurrentTrackLyrics();
					showToast("Текст удалён", "delete", saved.found ? "Найденный текст удалён вместе с твоими правками." : "Собственный текст удалён из HokenSync.");
					refresh();
				} catch (error) {
					console.warn("[HokenSync] Не удалось удалить текст из списка:", error);
					showToast("Не удалось удалить", "error", "Текст остался в списке.");
				}
			}, {
				title: "Удалить текст?",
				descriptionBefore: saved.found ? "Найденный текст для песни " : "Собственный текст для песни ",
				highlightedText: name,
				descriptionAfter: saved.found ? " будет удалён вместе с твоими правками и метками. Плеер сможет найти его заново." : " будет удалён из HokenSync.",
				icon: "🥺"
			});
		}
		for (const option of filterOptions) {
			const button = document.createElement("button");
			const text = document.createElement("span");
			const label = document.createElement("span");
			const badge = document.createElement("span");
			button.type = "button";
			button.className = "hokensync-navtab-item";
			button.setAttribute("role", "tab");
			button.setAttribute("aria-label", option.label);
			button.title = option.label;
			button.innerHTML = `<svg class="hokensync-navtab__svg" viewBox="0 0 24 24" aria-hidden="true">${option.icon}</svg>`;
			text.className = "hokensync-navtab__txt";
			label.className = "hokensync-navtab__label";
			label.textContent = option.label;
			text.appendChild(label);
			badge.className = "hokensync-navtab__count";
			text.appendChild(badge);
			button.appendChild(text);
			button.addEventListener("click", () => {
				if (libraryFilter === option.key) return;
				libraryFilter = option.key;
				refresh();
			});
			filterBar.appendChild(button);
			filterItems.push({
				key: option.key,
				button,
				label,
				badge
			});
		}
		new ResizeObserver(() => positionLine()).observe(filterBar);
		const footer = document.createElement("div");
		footer.id = "hokensync-library-footer";
		const backButton = createButton("Назад", () => uiState.navigation.showLyricsMenu());
		const saveButton = createButton("", () => void exportBackup(), "hokensync-library-tool hokensync-library-save");
		saveButton.innerHTML = ICONS.save;
		saveButton.setAttribute("aria-label", "Сохранить копию в файл");
		const loadButton = createButton("", importBackup, "hokensync-library-tool hokensync-library-load");
		loadButton.innerHTML = ICONS.upload;
		loadButton.setAttribute("aria-label", "Загрузить копию из файла");
		const toolbar = document.createElement("div");
		toolbar.className = "hokensync-library-toolbar";
		toolbar.appendChild(searchWrapper);
		toolbar.appendChild(saveButton);
		toolbar.appendChild(loadButton);
		footer.style.gap = "8px";
		backButton.style.marginLeft = "auto";
		footer.appendChild(backButton);
		wrapper.appendChild(header);
		wrapper.appendChild(toolbar);
		wrapper.appendChild(filterBar);
		wrapper.appendChild(list);
		wrapper.appendChild(footer);
		uiState.content.appendChild(wrapper);
		updateFilter();
		renderList();
		getEditedCachedLyrics().then((edited) => {
			if (!filterBar.isConnected) return;
			foundLyrics = edited.filter((entry) => !getSavedLyrics(entry.title, entry.artist)?.fromFound).map((entry) => ({
				title: entry.title,
				artist: entry.artist,
				lrc: entry.syncedLyrics ?? "",
				savedAt: entry.savedAt,
				coverUrl: entry.coverUrl,
				trackId: entry.trackId,
				found: true,
				foundBy: entry.foundBy === "hokensync" ? "HokenSync" : "PulseSync"
			}));
			foundLoaded = true;
			refresh();
		}).catch((error) => {
			console.warn("[HokenSync] Не удалось прочитать изменённые найденные тексты:", error);
			foundLoaded = true;
			if (filterBar.isConnected) refresh();
		});
	}
	//#endregion
	//#region src/sync.ts
	var NORMAL_ADJUSTMENT_SEC = .1;
	var FINE_ADJUSTMENT_SEC = .05;
	var PREVIEW_CONTEXT_SEC = .3;
	var PREVIEW_GAP_SEC = .1;
	function adjustLineTime(lines, index, delta) {
		const line = lines[index];
		if (!line || line.time === null) return;
		let newTime = Math.max(0, line.time + delta);
		const previous = lines[index - 1];
		const next = lines[index + 1];
		if (typeof previous?.time === "number" && newTime <= previous.time) newTime = previous.time + .01;
		if (typeof next?.time === "number" && newTime >= next.time) newTime = next.time - .01;
		line.time = Math.max(0, newTime);
	}
	function shiftAllTimes(lines, delta) {
		const times = lines.map((line) => line.time).filter((time) => typeof time === "number");
		if (!times.length || !Number.isFinite(delta)) return false;
		if (Math.min(...times) + delta < -1e-4) return false;
		for (const line of lines) if (typeof line.time === "number") line.time = Math.max(0, Math.round((line.time + delta) * 100) / 100);
		return true;
	}
	function skipBackward(seconds) {
		const current = getProgressSeconds() ?? 0;
		setProgress(Math.max(0, current - seconds));
	}
	function skipForward(seconds) {
		setProgress((getProgressSeconds() ?? 0) + seconds);
	}
	function calculatePreviewEnd(lines, index, duration) {
		const line = lines[index];
		if (!line || line.time === null) return 0;
		const nextTime = lines[index + 1]?.time;
		const trackEnd = typeof duration === "number" && duration > 0 ? duration : Number.POSITIVE_INFINITY;
		const nextEnd = typeof nextTime === "number" ? nextTime - PREVIEW_GAP_SEC : trackEnd;
		return Math.max(line.time + .05, Math.min(nextEnd, trackEnd));
	}
	function retakeLastLine(lines, currentIndex) {
		if (currentIndex <= 0) return null;
		let index = currentIndex - 1;
		while (index >= 0 && lines[index]?.isBreak) index -= 1;
		if (index < 0 || !lines[index]) return null;
		const oldTime = lines[index].time ?? null;
		lines[index].time = null;
		lines.splice(index + 1, Math.max(0, currentIndex - index - 1));
		return {
			index,
			position: Math.max(0, (oldTime ?? getProgressSeconds() ?? 0) - PREVIEW_CONTEXT_SEC)
		};
	}
	function getNextTextLineIndex(lines, index) {
		for (let i = index + 1; i < lines.length; i += 1) if (!lines[i]?.isBreak && lines[i]?.time !== null) return i;
		return -1;
	}
	function getPreviousTextLineIndex(lines, index) {
		for (let i = index - 1; i >= 0; i -= 1) if (!lines[i]?.isBreak && lines[i]?.time !== null) return i;
		return -1;
	}
	function getBreakAfterLineIndex(lines, textIndex) {
		const nextTextIndex = getNextTextLineIndex(lines, textIndex);
		for (let i = textIndex + 1; i < (nextTextIndex >= 0 ? nextTextIndex : lines.length); i += 1) if (lines[i]?.isBreak) return i;
		return -1;
	}
	function getBreakRange(lines, textIndex, duration) {
		const line = lines[textIndex];
		if (!line || line.isBreak || line.time === null) return null;
		const nextTextIndex = getNextTextLineIndex(lines, textIndex);
		const nextTime = nextTextIndex >= 0 ? lines[nextTextIndex]?.time : null;
		const trackEnd = typeof duration === "number" && duration > 0 ? duration : Number.POSITIVE_INFINITY;
		return {
			min: line.time,
			max: typeof nextTime === "number" ? nextTime : trackEnd
		};
	}
	function setBreakAfterLine(lines, textIndex, position) {
		const range = getBreakRange(lines, textIndex);
		if (!range || position <= range.min || position >= range.max) return null;
		const existingIndex = getBreakAfterLineIndex(lines, textIndex);
		if (existingIndex >= 0) {
			lines[existingIndex].time = position;
			return existingIndex;
		}
		const marker = {
			text: "",
			time: position,
			isBreak: true
		};
		const nextTextIndex = getNextTextLineIndex(lines, textIndex);
		const insertIndex = nextTextIndex >= 0 ? nextTextIndex : lines.length;
		lines.splice(insertIndex, 0, marker);
		return insertIndex;
	}
	function removeBreakMarker(lines, index) {
		if (!lines[index]?.isBreak) return false;
		lines.splice(index, 1);
		return true;
	}
	function getLastTextLineIndex(lines) {
		for (let i = lines.length - 1; i >= 0; i -= 1) if (!lines[i]?.isBreak && lines[i]?.time !== null) return i;
		return -1;
	}
	function getEndMarkerIndex(lines) {
		const last = getLastTextLineIndex(lines);
		return last < 0 ? -1 : getBreakAfterLineIndex(lines, last);
	}
	function ensureEndMarker(lines, position, duration) {
		const last = getLastTextLineIndex(lines);
		if (last < 0) return -1;
		const existing = getBreakAfterLineIndex(lines, last);
		if (existing >= 0) return existing;
		const start = lines[last].time ?? 0;
		let time = position !== null && position > start + 1 ? position : start + 3;
		if (typeof duration === "number" && duration > 0) time = Math.min(time, duration);
		time = Math.max(time, start + .05);
		lines.splice(last + 1, 0, {
			text: "",
			time,
			isBreak: true
		});
		return last + 1;
	}
	function trackJustRestarted(previous, current, duration) {
		if (previous === null || current === null) return false;
		if (typeof duration !== "number" || duration <= 0) return false;
		return previous >= duration - 2 && current <= 2 && current < previous;
	}
	//#endregion
	//#region src/ui/line-edit.ts
	function countTextLines() {
		return uiState.syncLines.filter((line) => !line.isBreak).length;
	}
	function textOrdinal(index) {
		return uiState.syncLines.slice(0, Math.max(0, index)).filter((line) => !line.isBreak).length;
	}
	function persist() {
		if (uiState.currentMode === "resync" || uiState.currentMode === "resync-review") {
			saveCurrentLyrics();
			return;
		}
		uiState.syncIndex = uiState.syncLines.length;
		saveCurrentDraft();
	}
	function renameLine(index, text) {
		const line = uiState.syncLines[index];
		const value = text.trim();
		if (!line || line.isBreak) return false;
		if (!value) {
			showToast("Строка не может быть пустой", "warning", "Введи текст строки или нажми Esc.");
			return false;
		}
		if (value === line.text) return true;
		line.text = value;
		persist();
		showToast("Изменение сохранено", "info", "Текст строки обновлён.");
		return true;
	}
	function insertLineAfter(index, text) {
		const lines = uiState.syncLines;
		const previous = index < 0 ? {
			time: 0,
			isBreak: false
		} : lines[index];
		const value = text.trim();
		if (!previous || previous.isBreak || previous.time === null) return -1;
		if (!value) {
			showToast("Строка не может быть пустой", "warning", "Введи текст строки или нажми Esc.");
			return -1;
		}
		let nextTime = null;
		for (let i = index + 1; i < lines.length; i += 1) if (lines[i].time !== null) {
			nextTime = lines[i].time;
			break;
		}
		const duration = uiState.currentTrack?.duration;
		let time;
		if (nextTime !== null) time = previous.time + (nextTime - previous.time) / 2;
		else {
			const room = typeof duration === "number" && duration > previous.time ? duration - previous.time : 4;
			time = previous.time + Math.min(2, room / 2);
		}
		const ordinal = index < 0 ? 0 : textOrdinal(index) + 1;
		const shiftFrom = index < 0 ? ordinal + 1 : ordinal;
		uiState.sections.forEach((mark) => {
			if (mark.before >= shiftFrom) mark.before += 1;
		});
		lines.splice(index + 1, 0, {
			text: value,
			time
		});
		persist();
		showToast("Строка добавлена", "success", "Теперь поправь её таймкод.");
		return index + 1;
	}
	function removeLine(index) {
		const lines = uiState.syncLines;
		const line = lines[index];
		if (!line || line.isBreak) return false;
		if (countTextLines() <= 1) {
			showToast("Строку удалить нельзя", "warning", "В тексте должна остаться хотя бы одна строка.");
			return false;
		}
		const ordinal = textOrdinal(index);
		uiState.sections.forEach((mark) => {
			if (mark.before > ordinal) mark.before -= 1;
		});
		lines.splice(index, 1);
		persist();
		showToast("Строка удалена", "delete", "Таймкоды остальных строк не изменились.");
		return true;
	}
	function labelWithNumber(baseLabel, ignorePosition = -1) {
		if (baseLabel !== "Куплет") return baseLabel;
		return `Куплет ${uiState.sections.filter((mark, position) => position !== ignorePosition && /^Куплет/i.test(mark.label)).length + 1}`;
	}
	function insertSectionBefore(index, baseLabel) {
		const ordinal = textOrdinal(index);
		const label = labelWithNumber(baseLabel);
		let position = uiState.sections.length;
		for (let i = uiState.sections.length - 1; i >= 0; i -= 1) {
			if (uiState.sections[i].before <= ordinal) break;
			position = i;
		}
		uiState.sections.splice(position, 0, {
			before: ordinal,
			label
		});
		persist();
		showToast("Метка добавлена", "success", `${label}. В LRC она не попадает.`);
	}
	function replaceSection(position, baseLabel) {
		const mark = uiState.sections[position];
		if (!mark) return;
		const label = labelWithNumber(baseLabel, position);
		if (label === mark.label) return;
		mark.label = label;
		persist();
		showToast("Метка изменена", "info", label);
	}
	function removeSectionAt(position) {
		const mark = uiState.sections[position];
		if (!mark) return;
		uiState.sections.splice(position, 1);
		persist();
		showToast("Метка удалена", "delete", mark.label);
	}
	function createLineInput(initial, placeholder, onCommit, onCancel) {
		const input = document.createElement("input");
		let finished = false;
		input.type = "text";
		input.className = "hokensync-line-input";
		input.value = initial;
		input.placeholder = placeholder;
		input.autocomplete = "off";
		input.spellcheck = false;
		const finish = (commit) => {
			if (finished) return;
			finished = true;
			if (commit) onCommit(input.value);
			else onCancel();
		};
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				finish(true);
			} else if (event.key === "Escape") {
				event.preventDefault();
				finish(false);
			}
		});
		input.addEventListener("blur", () => finish(false));
		return input;
	}
	//#endregion
	//#region src/ui/review-screen.ts
	function isEndStep() {
		const index = uiState.reviewIndex;
		return Boolean(uiState.syncLines[index]?.isBreak) && index === getEndMarkerIndex(uiState.syncLines);
	}
	function beginReviewEdit(mode) {
		const textElement = document.getElementById("hokensync-review-text");
		const index = uiState.reviewIndex;
		const line = uiState.syncLines[index];
		const isResync = uiState.currentMode === "resync-review";
		if (!textElement || !line || line.isBreak) return;
		const input = createLineInput(mode === "rename" ? line.text : "", mode === "rename" ? "Текст строки" : "Текст новой строки, Enter — добавить", (value) => {
			if (mode === "rename") {
				renameLine(index, value);
				renderReviewScreen(isResync);
				return;
			}
			const created = insertLineAfter(index, value);
			if (created >= 0) uiState.reviewIndex = created;
			renderReviewScreen(isResync);
			if (created >= 0) startReviewPreview();
		}, () => renderReviewScreen(isResync));
		input.classList.add("hokensync-review-input");
		textElement.replaceChildren(input);
		input.focus();
		input.select();
	}
	function confirmDeleteReviewLine() {
		const index = uiState.reviewIndex;
		const line = uiState.syncLines[index];
		const isResync = uiState.currentMode === "resync-review";
		if (!line || line.isBreak) return;
		showDeleteConfirm(() => {
			if (!removeLine(index)) return;
			let next = getNextTextLineIndex(uiState.syncLines, index - 1);
			if (next < 0) next = getPreviousTextLineIndex(uiState.syncLines, index);
			uiState.reviewIndex = Math.max(0, next);
			renderReviewScreen(isResync);
			startReviewPreview();
		}, {
			title: "Удалить строку?",
			descriptionBefore: "Строка ",
			highlightedText: `«${line.text}»`,
			descriptionAfter: " будет удалена из текста.",
			icon: "🥺"
		});
	}
	function skipEndStep(isResync) {
		const index = uiState.reviewIndex;
		if (!isEndStep()) return;
		stopReviewPreview();
		uiState.syncLines.splice(index, 1);
		uiState.reviewIndex = Math.max(0, getLastTextLineIndex(uiState.syncLines));
		if (isResync) {
			saveCurrentLyrics();
			showToast("Конец строки убран", "delete", "Подсветка последней строки продлится до конца песни.");
			uiState.navigation.showResyncList();
			return;
		}
		finishLyrics();
	}
	function openEndStep() {
		const index = ensureEndMarker(uiState.syncLines, getProgressSeconds(), uiState.currentTrack?.duration);
		if (index < 0) {
			stopReviewPreview();
			finishLyrics();
			return;
		}
		uiState.reviewIndex = index;
		saveCurrentDraft();
		renderReviewScreen();
		startReviewPreview();
	}
	function stopReviewPreview() {
		clearPreviewTimers();
		pause();
		uiState.previewPlaying = false;
		updatePreviewButtons();
	}
	function startReviewPreview() {
		uiState.playbackControlActive = true;
		clearPreviewTimers();
		const line = uiState.syncLines[uiState.reviewIndex];
		if (!line || line.time === null) {
			stopReviewPreview();
			return;
		}
		const runId = uiState.previewRunId;
		const duration = uiState.currentTrack?.duration;
		let start;
		let end;
		if (isEndStep()) {
			const lastIndex = getLastTextLineIndex(uiState.syncLines);
			const lastStart = lastIndex >= 0 ? uiState.syncLines[lastIndex].time ?? 0 : 0;
			const trackEnd = typeof duration === "number" && duration > 0 ? duration : Number.POSITIVE_INFINITY;
			start = Math.max(0, lastStart);
			end = Math.max(start + .3, Math.min(line.time, trackEnd));
		} else {
			start = Math.max(0, line.time - PREVIEW_CONTEXT_SEC);
			end = calculatePreviewEnd(uiState.syncLines, uiState.reviewIndex, duration);
		}
		uiState.previewPlaying = false;
		updatePreviewButtons();
		setProgress(start);
		if (!isPlaying()) try {
			const res = play();
			if (res && typeof res.then === "function") res.then(() => {
				if (runId !== uiState.previewRunId) pause();
			}).catch((err) => {
				if (runId !== uiState.previewRunId) return;
				if (!(err instanceof Error && err.name === "AbortError")) stopReviewPreview();
			});
		} catch (err) {
			if (runId === uiState.previewRunId) {
				if (!(err instanceof Error && err.name === "AbortError")) stopReviewPreview();
			}
		}
		window.setTimeout(() => {
			if (runId !== uiState.previewRunId) return;
			initPreviewWatch(runId, start, end);
		}, 50);
	}
	function initPreviewWatch(runId, start, end) {
		const startTimeMs = Date.now();
		const startTimeoutMs = 2e3;
		const duration = uiState.currentTrack?.duration;
		const endsAtTrackEnd = typeof duration === "number" && duration > 0 && end >= duration - .05;
		let hasRewound = false;
		let lastPosition = null;
		let endedSince = 0;
		const watch = () => {
			if (runId !== uiState.previewRunId) return;
			const current = getProgressSeconds();
			const playingNow = isPlaying();
			if (trackJustRestarted(lastPosition, current, duration)) {
				lastPosition = current;
				stopReviewPreview();
				return;
			}
			lastPosition = current;
			const atTrackEnd = typeof duration === "number" && duration > 0 && typeof current === "number" && current >= duration - 1.5;
			if (playingNow) {
				endedSince = 0;
				if (!uiState.previewPlaying) {
					uiState.previewPlaying = true;
					updatePreviewButtons();
				}
			} else if (uiState.previewPlaying && typeof current === "number") {
				if (!atTrackEnd) {
					stopReviewPreview();
					return;
				}
				if (!endedSince) endedSince = Date.now();
				if (Date.now() - endedSince > 1500) {
					stopReviewPreview();
					return;
				}
			}
			if (!uiState.previewPlaying && Date.now() - startTimeMs > startTimeoutMs) {
				uiState.previewPlaying = false;
				updatePreviewButtons();
				uiState.previewWatchFrame = 0;
				return;
			}
			if (typeof current === "number") {
				if (!hasRewound) {
					const isNearStart = Math.abs(current - start) < .8;
					const isBeforeEnd = current < end - .05;
					const timePassed = Date.now() - startTimeMs > 300;
					if (isNearStart || isBeforeEnd || timePassed) hasRewound = true;
				}
				if (uiState.previewPlaying && hasRewound && !endsAtTrackEnd && current >= end - .02) {
					stopReviewPreview();
					return;
				}
			}
			updatePreviewButtons();
			uiState.previewWatchFrame = window.requestAnimationFrame(watch);
		};
		uiState.previewWatchFrame = window.requestAnimationFrame(watch);
	}
	function acceptReviewLine() {
		if (uiState.currentMode === "resync-review") {
			const line = uiState.syncLines[uiState.reviewIndex];
			const endStep = isEndStep();
			const nextIndex = endStep ? -1 : getNextTextLineIndex(uiState.syncLines, uiState.reviewIndex);
			if (nextIndex >= 0) clearPreviewTimers();
			else stopReviewPreview();
			saveCurrentLyrics();
			reviewSnapshot = null;
			showToast("Изменение сохранено", "info", line?.time !== null && line?.time !== void 0 ? `${endStep ? "Новый конец" : "Новый таймкод"}: ${formatTime(line.time)}` : void 0);
			if (nextIndex >= 0) {
				uiState.reviewIndex = nextIndex;
				rememberReviewLine();
				renderReviewScreen(true);
				startReviewPreview();
				return;
			}
			uiState.navigation.showResyncList();
			return;
		}
		if (isEndStep()) {
			stopReviewPreview();
			finishLyrics();
			return;
		}
		const nextReviewIndex = getNextTextLineIndex(uiState.syncLines, uiState.reviewIndex);
		if (nextReviewIndex < 0) {
			clearPreviewTimers();
			openEndStep();
			return;
		}
		clearPreviewTimers();
		uiState.reviewIndex = nextReviewIndex;
		saveCurrentDraft();
		renderReviewScreen();
		startReviewPreview();
	}
	var reviewSnapshot = null;
	function rememberReviewLine() {
		const line = uiState.syncLines[uiState.reviewIndex];
		reviewSnapshot = line ? {
			index: uiState.reviewIndex,
			time: line.time
		} : null;
	}
	function discardReviewChanges() {
		const snapshot = reviewSnapshot;
		reviewSnapshot = null;
		if (!snapshot || snapshot.index !== uiState.reviewIndex) return;
		const line = uiState.syncLines[snapshot.index];
		if (!line || line.time === snapshot.time) return;
		line.time = snapshot.time;
	}
	function adjustReviewTime(delta, isResync) {
		adjustLineTime(uiState.syncLines, uiState.reviewIndex, delta);
		if (!isResync) saveCurrentDraft();
		const timeEl = document.getElementById("hokensync-review-time");
		const currentLine = uiState.syncLines[uiState.reviewIndex];
		if (timeEl && currentLine?.time !== null) timeEl.textContent = `${isEndStep() ? "Конец" : "Таймкод"}: ${formatTime(currentLine.time)}`;
		startReviewPreview();
	}
	function normalizeReviewIndex() {
		if (isEndStep()) return;
		if (!uiState.syncLines[uiState.reviewIndex]?.isBreak && uiState.syncLines[uiState.reviewIndex]?.time !== null) return;
		const next = getNextTextLineIndex(uiState.syncLines, uiState.reviewIndex - 1);
		uiState.reviewIndex = next >= 0 ? next : 0;
	}
	function getReviewPosition() {
		const textIndexes = uiState.syncLines.map((line, index) => !line.isBreak && line.time !== null ? index : -1).filter((index) => index >= 0);
		const total = textIndexes.length + 1;
		if (isEndStep()) return {
			current: total,
			total
		};
		return {
			current: Math.max(0, textIndexes.indexOf(uiState.reviewIndex)) + 1,
			total
		};
	}
	function goToPreviousReviewLine(isResync = uiState.currentMode === "resync-review") {
		const previousReviewIndex = getPreviousTextLineIndex(uiState.syncLines, uiState.reviewIndex);
		if (previousReviewIndex < 0) return;
		clearPreviewTimers();
		if (isResync) discardReviewChanges();
		uiState.reviewIndex = previousReviewIndex;
		if (isResync) rememberReviewLine();
		else saveCurrentDraft();
		renderReviewScreen(isResync);
		startReviewPreview();
	}
	function renderReviewScreen(isResync = false) {
		if (!uiState.content) return;
		normalizeReviewIndex();
		uiState.currentMode = isResync ? "resync-review" : "review";
		setContent();
		const line = uiState.syncLines[uiState.reviewIndex];
		if (!line || line.time === null) {
			finishLyrics();
			return;
		}
		const reviewLine = document.createElement("div");
		reviewLine.id = "hokensync-review-line";
		const status = document.createElement("div");
		status.id = "hokensync-review-status";
		const reviewPosition = getReviewPosition();
		status.textContent = `Проверка ${reviewPosition.current} / ${reviewPosition.total}`;
		const endStep = isEndStep();
		const lastTextIndex = getLastTextLineIndex(uiState.syncLines);
		const reviewText = document.createElement("div");
		reviewText.id = "hokensync-review-text";
		reviewText.textContent = endStep ? "Конец последней строки" : line.isBreak ? "••• Проигрыш •••" : line.text;
		if (line.isBreak && !endStep) reviewText.style.opacity = "0.5";
		const reviewTime = document.createElement("div");
		reviewTime.id = "hokensync-review-time";
		reviewTime.textContent = `${endStep ? "Конец" : "Таймкод"}: ${formatTime(line.time)}`;
		reviewLine.appendChild(status);
		reviewLine.appendChild(reviewText);
		if (endStep && lastTextIndex >= 0) {
			const context = document.createElement("div");
			context.id = "hokensync-review-context";
			context.textContent = uiState.syncLines[lastTextIndex].text;
			reviewLine.appendChild(context);
		}
		reviewLine.appendChild(reviewTime);
		if (endStep) {
			const note = document.createElement("div");
			note.id = "hokensync-review-note";
			note.textContent = "Повтор играет от начала последней строки до выбранного конца. После указанного таймкода текст потухнет.";
			reviewLine.appendChild(note);
		} else {
			const toolbar = document.createElement("div");
			toolbar.className = "hokensync-review-toolbar";
			const makeTool = (className, icon, label, onClick) => {
				const button = createButton("", onClick, `hokensync-tool-btn ${className}`);
				button.innerHTML = icon;
				button.setAttribute("aria-label", label);
				toolbar.appendChild(button);
			};
			makeTool("hokensync-tool-edit", ICONS.pencil, "Изменить текст строки", () => beginReviewEdit("rename"));
			makeTool("hokensync-tool-insert", ICONS.rowPlus, "Вставить строку после этой", () => beginReviewEdit("insert"));
			makeTool("hokensync-tool-delete", ICONS.trash, "Удалить строку", confirmDeleteReviewLine);
			reviewLine.appendChild(toolbar);
		}
		const help = document.createElement("div");
		help.id = "hokensync-review-help";
		help.textContent = isResync ? "← / → ±0.10 с | Shift + ← / → ±0.05 с | Space – повторить | Enter – применить и к следующей строке | Backspace – к предыдущей строке | ESC – отменить и к списку" : `← / → ±0.10 с | Shift + ← / → ±0.05 с | Space – повторить | Enter – ${endStep ? "готово" : "далее"} | Backspace – к предыдущей строке | ESC – закрыть`;
		const buttons = document.createElement("div");
		buttons.id = "hokensync-buttons";
		const back = createButton("−0.10", () => adjustReviewTime(-NORMAL_ADJUSTMENT_SEC, isResync));
		const fineBack = createButton("−0.05", () => adjustReviewTime(-FINE_ADJUSTMENT_SEC, isResync));
		const repeat = createButton("▶ Повторить", () => {
			if (uiState.previewPlaying) stopReviewPreview();
			else startReviewPreview();
		}, "hokensync-preview-toggle");
		repeat.dataset.previewButton = "true";
		const fineForward = createButton("+0.05", () => adjustReviewTime(FINE_ADJUSTMENT_SEC, isResync));
		const forward = createButton("+0.10", () => adjustReviewTime(NORMAL_ADJUSTMENT_SEC, isResync));
		const backToPrevious = createButton(reviewPosition.current > 1 ? `← Назад к ${reviewPosition.current - 1}/${reviewPosition.total}` : "← Назад", () => goToPreviousReviewLine(isResync));
		backToPrevious.disabled = reviewPosition.current <= 1;
		const backToSync = createButton("↩ Вернуться к проставлению таймкодов", () => uiState.navigation.returnToSyncEditing());
		backToSync.style.display = isResync ? "none" : "";
		const accept = createButton(isResync ? "Применить" : endStep ? "Готово" : "Далее", acceptReviewLine, isResync ? "primary hokensync-btn-apply" : "primary");
		const noEnd = createButton("Без конца строки", () => skipEndStep(isResync));
		const cancel = createButton(isResync ? "К списку" : "Закрыть", isResync ? () => {
			clearPreviewTimers();
			uiState.playbackControlActive = false;
			if (isPlaying()) pause();
			discardReviewChanges();
			uiState.navigation.showResyncList();
		} : () => uiState.navigation.closeEditor(), "ml-auto");
		buttons.appendChild(back);
		buttons.appendChild(fineBack);
		buttons.appendChild(repeat);
		buttons.appendChild(fineForward);
		buttons.appendChild(forward);
		buttons.appendChild(backToPrevious);
		buttons.appendChild(backToSync);
		if (endStep) buttons.appendChild(noEnd);
		buttons.appendChild(accept);
		buttons.appendChild(cancel);
		uiState.content.appendChild(reviewLine);
		uiState.content.appendChild(help);
		uiState.content.appendChild(buttons);
		updatePreviewButtons();
	}
	function updatePreviewButtons() {
		document.querySelectorAll("[data-preview-button=\"true\"]").forEach((button) => {
			button.textContent = uiState.previewPlaying ? "⏹ Стоп" : "▶ Повторить";
			button.disabled = false;
		});
	}
	//#endregion
	//#region src/ui/menu.ts
	var ICON_CHECK = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M5 12.5l4.5 4.5L19 7.5\"/></svg>";
	var ICON_PLUS = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 5v14M5 12h14\"/></svg>";
	var ICON_NOTE = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M9 18V6.5l10-2V16\"/><circle cx=\"6.8\" cy=\"18\" r=\"2.4\"/><circle cx=\"16.8\" cy=\"16\" r=\"2.4\"/></svg>";
	async function renderLyricsMenu() {
		if (!uiState.content || !uiState.currentTrack) return;
		uiState.editingFound = false;
		uiState.currentMode = "text";
		setContent();
		const track = uiState.currentTrack;
		await whenFoundSaved();
		const cached = await getCachedLyrics(track.title, track.artist);
		if (!uiState.content || !uiState.currentTrack || uiState.currentTrack.title !== track.title || uiState.currentTrack.artist !== track.artist) return;
		if (cached?.edited && !cached.coverUrl && track.coverUrl) attachCoverToEditedLyrics(track.title, track.artist, track.coverUrl).catch(() => void 0);
		if (cached?.edited && !cached.trackId && track.id) attachTrackIdToEditedLyrics(track.title, track.artist, track.id).catch(() => void 0);
		const saved = getSavedLyrics(track.title, track.artist);
		if (saved && !saved.trackId && track.id) saveLyrics({
			...saved,
			trackId: track.id
		});
		const source = getLyricsSource(track);
		const wrapper = document.createElement("div");
		wrapper.id = "hokensync-warning";
		const icon = document.createElement("div");
		icon.id = "hokensync-warning-icon";
		const title = document.createElement("div");
		title.id = "hokensync-warning-title";
		const description = document.createElement("div");
		description.id = "hokensync-warning-description";
		if (saved) {
			wrapper.classList.add("hokensync-state-saved");
			icon.innerHTML = ICON_CHECK;
			title.textContent = "Свой текст добавлен";
			description.textContent = "Можно поправить таймкоды отдельных строк или удалить текст и добавить заново.";
		} else if (source === "native") {
			wrapper.classList.add("hokensync-state-native");
			icon.innerHTML = ICON_NOTE;
			title.textContent = "У песни есть текст Яндекс Музыки";
			description.textContent = "HokenSync не будет заменять официальный текст автоматически.";
		} else if (cached?.syncedLyrics?.trim()) {
			wrapper.classList.add("hokensync-state-found");
			icon.innerHTML = ICON_NOTE;
			if (cached.foundBy === "hokensync") {
				title.textContent = "Текст найден HokenSync";
				description.textContent = "Он подставляется автоматически. Если не подходит, открой «Редактор текста», вкладку «Свой текст» и нажми «Найти текст».";
			} else {
				title.textContent = "Найден текст PulseSync / LRCLIB";
				description.textContent = "HokenSync может использовать найденную синхронизацию.";
			}
		} else if (getCachedVariants(track)?.length) {
			wrapper.classList.add("hokensync-state-found");
			icon.innerHTML = ICON_NOTE;
			title.textContent = "В интернете есть текст";
			description.textContent = "HokenSync нашёл варианты, но не подставил их сам: они могут не подходить. Выбрать можно в «Добавить свой текст» → «Найти текст».";
		} else {
			wrapper.classList.add("hokensync-state-empty");
			icon.innerHTML = ICON_PLUS;
			title.textContent = "Своего текста пока нет";
			description.textContent = "Добавь текст песни и синхронизируй его с музыкой.";
		}
		const hasDraft = !saved && Boolean(loadDraft(track.artist, track.title));
		const hasTypedText = !saved && !hasDraft && Boolean(loadTextDraft(track.artist, track.title).trim());
		if (hasDraft || hasTypedText) {
			const pill = document.createElement("div");
			pill.className = "hokensync-draft-pill";
			const dot = document.createElement("span");
			dot.className = "hokensync-draft-dot";
			const label = document.createElement("span");
			label.textContent = hasDraft ? "Есть незавершённая разметка" : "Есть набранный текст";
			pill.appendChild(dot);
			pill.appendChild(label);
			wrapper.appendChild(pill);
		}
		const memoryStatus = document.createElement("div");
		memoryStatus.id = "hokensync-memory-status";
		const memoryIcon = document.createElement("span");
		memoryIcon.id = "hokensync-memory-icon";
		const memoryText = document.createElement("span");
		const updateMemoryStatus = async () => {
			if (!uiState.content || !uiState.currentTrack || uiState.currentTrack.title !== track.title || uiState.currentTrack.artist !== track.artist) {
				stopLyricsMenuWatch();
				return;
			}
			const latestCached = await getCachedLyrics(track.title, track.artist);
			const latestNotFound = await hasLyricsNotFound(track.title, track.artist);
			if (getLyricsSource(track) === "native") {
				memoryIcon.textContent = "☁️";
				memoryText.textContent = "Для этой песни сохранение текста не требуется.";
				memoryStatus.className = "hokensync-memory-status hokensync-memory-status-not-required";
				stopLyricsMenuWatch();
				return;
			}
			if (latestCached?.syncedLyrics?.trim()) {
				memoryIcon.textContent = "💾";
				memoryText.textContent = latestCached.foundBy === "hokensync" ? "Текст найден HokenSync и подставляется автоматически." : "Текст для этой песни подставляется автоматически.";
				memoryStatus.className = "hokensync-memory-status hokensync-memory-status-saved";
				stopLyricsMenuWatch();
				return;
			}
			if (getCachedVariants(track)?.length) {
				memoryIcon.textContent = "🔎";
				memoryText.textContent = "В интернете есть текст, но HokenSync не уверен, что он подходит.";
				memoryStatus.className = "hokensync-memory-status hokensync-memory-status-empty";
				stopLyricsMenuWatch();
				return;
			}
			if (latestNotFound) {
				memoryIcon.textContent = "📛";
				memoryText.textContent = "Текст для этой песни не найден.";
				memoryStatus.className = "hokensync-memory-status hokensync-memory-status-not-found";
				stopLyricsMenuWatch();
				return;
			}
			if (isCurrentTrackLyricsLoading() || isHokenSearchRunning(track.title, track.artist)) {
				memoryIcon.textContent = "📥";
				memoryText.textContent = "Поиск текста к этой песне в интернете.";
				memoryStatus.className = "hokensync-memory-status hokensync-memory-status-saving";
				return;
			}
			const failure = getHokenSearchFailure(track.title, track.artist);
			if (failure) {
				memoryIcon.textContent = failure === "network" ? "📡" : "⏳";
				memoryText.textContent = failure === "limit" ? "LRCLIB ограничил запросы. Повторим чуть позже." : failure === "server" ? "Сервер LRCLIB недоступен. Повторим позже." : "Нет связи с LRCLIB. Включи VPN или прокси.";
				memoryStatus.className = failure === "network" ? "hokensync-memory-status hokensync-memory-status-not-found" : "hokensync-memory-status hokensync-memory-status-empty";
				return;
			}
			memoryIcon.textContent = "☁️";
			memoryText.textContent = "Для этой песни сохранение текста не требуется.";
			memoryStatus.className = "hokensync-memory-status hokensync-memory-status-not-required";
			stopLyricsMenuWatch();
		};
		updateMemoryStatus();
		stopLyricsMenuWatch();
		uiState.lyricsMenuWatchTimer = window.setInterval(() => void updateMemoryStatus(), 500);
		memoryStatus.appendChild(memoryIcon);
		memoryStatus.appendChild(memoryText);
		const buttons = document.createElement("div");
		buttons.id = "hokensync-buttons";
		const hasFound = !saved && source !== "native" && Boolean(cached?.syncedLyrics?.trim());
		const openFound = hasFound && !hasDraft && !hasTypedText;
		const addButton = createButton(saved ? "Изменить свой текст" : hasFound ? "Редактор текста" : "Добавить свой текст", () => {
			if (openFound) {
				renderFoundTextEditor();
				return;
			}
			uiState.navigation.showTextEditor();
		}, saved ? "hokensync-edit-text-btn" : "primary");
		const clearCacheButton = createButton("🧼", () => {
			showDeleteConfirm(async () => {
				try {
					await clearLyricsCache();
					showToast("Сохранённые тексты удалены", "delete", "Собственные тексты HokenSync остались.");
					updateMemoryStatus();
				} catch (error) {
					console.error("[HokenSync] Не удалось очистить базу текстов:", error);
					showToast("Не удалось очистить", "error", "Сохранённые тексты не удалены.");
				}
			}, {
				title: "Очистить сохранённые тексты?",
				descriptionBefore: "Все автоматически сохранённые тексты ",
				highlightedText: "LRCLIB / PulseSync",
				descriptionAfter: " будут удалены. Собственные тексты HokenSync останутся.",
				icon: "🗑️",
				countdownSeconds: 3
			});
		});
		clearCacheButton.id = "hokensync-cache-clear-btn";
		clearCacheButton.title = "Очистить сохранённые тексты";
		clearCacheButton.setAttribute("aria-label", "Очистить сохранённые тексты");
		const myLyricsButton = createButton("Мои тексты", () => uiState.navigation.showSavedLyricsList());
		const closeButton = createButton("Закрыть", () => uiState.navigation.closeEditor(), "ml-auto");
		buttons.appendChild(addButton);
		buttons.appendChild(myLyricsButton);
		buttons.appendChild(closeButton);
		wrapper.appendChild(clearCacheButton);
		wrapper.appendChild(icon);
		wrapper.appendChild(title);
		wrapper.appendChild(description);
		if (saved) {
			const switchRow = document.createElement("label");
			switchRow.className = "hokensync-switch-row";
			const switchText = document.createElement("span");
			switchText.className = "hokensync-switch-text";
			switchText.textContent = "Использовать свой текст";
			const input = document.createElement("input");
			input.type = "checkbox";
			input.className = "hokensync-switch-input";
			input.setAttribute("role", "switch");
			input.checked = !isCustomLyricsDisabled(saved.artist, saved.title);
			const track = document.createElement("span");
			track.className = "hokensync-switch-track";
			const applyState = () => {
				wrapper.classList.toggle("hokensync-state-off", !input.checked);
				title.textContent = input.checked ? "Свой текст добавлен" : "Свой текст отключён";
			};
			input.addEventListener("change", () => {
				setCustomLyricsDisabled(saved.artist, saved.title, !input.checked);
				applyState();
				refreshCurrentTrackLyrics();
				if (input.checked) showToast("Свой текст включён", "success", "Он снова используется для этой песни.");
				else showToast("Свой текст отключён", "info", "Он сохранён, но не используется. Покажется текст Яндекса или PulseSync, если он есть.");
			});
			applyState();
			switchRow.appendChild(switchText);
			switchRow.appendChild(input);
			switchRow.appendChild(track);
			wrapper.appendChild(switchRow);
		}
		wrapper.appendChild(memoryStatus);
		wrapper.appendChild(buttons);
		uiState.content.appendChild(wrapper);
	}
	//#endregion
	//#region src/ui/sync-screen.ts
	var lineKeys = /* @__PURE__ */ new WeakMap();
	var nextLineKey = 1;
	var lastRenderedIndex = -1;
	function keyOf(line) {
		let key = lineKeys.get(line);
		if (!key) {
			key = nextLineKey;
			nextLineKey += 1;
			lineKeys.set(line, key);
		}
		return key;
	}
	var SHIFT_MS = 340;
	var SHIFT_EASING = "cubic-bezier(.16, 1, .3, 1)";
	function captureSyncLines() {
		const lines = /* @__PURE__ */ new Map();
		uiState.content?.querySelectorAll("[data-line-key]").forEach((element) => {
			const key = Number(element.dataset.lineKey);
			if (!Number.isFinite(key)) return;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			lines.set(key, {
				centerY: rect.top + rect.height / 2,
				fontSize: Number.parseFloat(style.fontSize),
				color: style.color
			});
		});
		return { lines };
	}
	function playSyncShift(before, direction) {
		if (!before.lines.size) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		uiState.content?.querySelectorAll("[data-line-key]").forEach((element) => {
			const old = before.lines.get(Number(element.dataset.lineKey));
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			if (!old) {
				element.animate([{
					opacity: 0,
					transform: `translateY(${24 * direction}px)`
				}, {
					opacity: 1,
					transform: "none"
				}], {
					duration: SHIFT_MS,
					easing: SHIFT_EASING
				});
				return;
			}
			const shiftY = old.centerY - (rect.top + rect.height / 2);
			const scale = old.fontSize / (Number.parseFloat(style.fontSize) || old.fontSize);
			if (Math.abs(shiftY) < 1 && Math.abs(scale - 1) < .01) return;
			element.animate([{
				transform: `translateY(${shiftY}px) scale(${scale})`,
				color: old.color
			}, {
				transform: "none",
				color: style.color
			}], {
				duration: SHIFT_MS,
				easing: SHIFT_EASING
			});
		});
	}
	function previousTextIndex(from) {
		for (let i = from - 1; i >= 0; i -= 1) if (!uiState.syncLines[i]?.isBreak) return i;
		return -1;
	}
	function nextTextIndexes(from, count) {
		const result = [];
		for (let i = from + 1; i < uiState.syncLines.length && result.length < count; i += 1) if (!uiState.syncLines[i]?.isBreak) result.push(i);
		return result;
	}
	function progressLabel() {
		const total = uiState.syncLines.filter((line) => !line.isBreak).length;
		const done = uiState.syncLines.slice(0, uiState.syncIndex).filter((line) => !line.isBreak).length;
		return `${Math.min(done + 1, total)} / ${total}`;
	}
	function startSynchronization(lines, sections = []) {
		if (!uiState.currentTrack) return;
		clearSyncAnimation();
		uiState.playbackControlActive = true;
		uiState.syncLines = lines.map((text) => ({
			text,
			time: null
		}));
		uiState.sections = sections.map((mark) => ({ ...mark }));
		uiState.syncIndex = 0;
		uiState.reviewIndex = 0;
		uiState.reviewReturnIndex = 0;
		uiState.reviewReturnTimes = /* @__PURE__ */ new WeakMap();
		uiState.currentMode = "sync";
		saveCurrentDraft();
		renderSyncScreen();
		setProgress(0);
		play();
	}
	function renderSyncScreen() {
		if (!uiState.content) return;
		uiState.currentMode = "sync";
		const before = captureSyncLines();
		const direction = uiState.syncIndex >= lastRenderedIndex ? 1 : -1;
		lastRenderedIndex = uiState.syncIndex;
		setContent();
		if (before.lines.size > 0) uiState.content.classList.add("hokensync-no-enter");
		const top = document.createElement("div");
		top.id = "hokensync-sync-top";
		const currentTime = document.createElement("div");
		currentTime.id = "hokensync-current-time";
		currentTime.textContent = formatTime(getProgressSeconds() ?? 0);
		const progress = document.createElement("div");
		progress.id = "hokensync-progress";
		progress.textContent = progressLabel();
		top.appendChild(currentTime);
		top.appendChild(progress);
		const previous = document.createElement("div");
		previous.id = "hokensync-previous-line";
		const previousIndex = previousTextIndex(uiState.syncIndex);
		previous.textContent = previousIndex >= 0 ? uiState.syncLines[previousIndex].text : "";
		if (previousIndex >= 0) previous.dataset.lineKey = String(keyOf(uiState.syncLines[previousIndex]));
		const mainLine = document.createElement("div");
		mainLine.id = "hokensync-main-line";
		const currentLine = uiState.syncLines[uiState.syncIndex];
		mainLine.textContent = currentLine?.isBreak ? "••• Проигрыш •••" : currentLine?.text ?? "Синхронизация закончена";
		if (currentLine?.isBreak) mainLine.style.opacity = "0.5";
		if (currentLine) mainLine.dataset.lineKey = String(keyOf(currentLine));
		const nextLines = document.createElement("div");
		nextLines.id = "hokensync-next-lines";
		nextTextIndexes(uiState.syncIndex, 3).forEach((index) => {
			const element = document.createElement("div");
			element.className = "hokensync-next-line";
			element.textContent = uiState.syncLines[index].text;
			element.dataset.lineKey = String(keyOf(uiState.syncLines[index]));
			nextLines.appendChild(element);
		});
		const hint = document.createElement("div");
		hint.id = "hokensync-sync-hint";
		hint.textContent = "Enter – метка | B – проигрыш | Backspace – вернуть строку | ← / → 3 с (зажми — быстрее) | Space – пауза | ESC – закрыть";
		const controls = document.createElement("div");
		controls.id = "hokensync-buttons";
		const playPauseButton = createButton(isPlaying() ? "⏸ Пауза" : "▶ Играть", () => {
			togglePlayPause();
			updateSyncPlayButton(playPauseButton);
		});
		playPauseButton.style.width = "100px";
		playPauseButton.style.minWidth = "100px";
		controls.appendChild(createButton("⏮ С начала", () => {
			if (isPlaying()) pause();
			setProgress(0);
			updateSyncPlayButton(playPauseButton);
		}));
		controls.appendChild(playPauseButton);
		controls.appendChild(createButton("−3 с", () => skipBackward(3)));
		controls.appendChild(createButton("+3 с", () => skipForward(3)));
		const retakeButton = createButton("← Последняя строка", retakeCurrentSyncLine);
		retakeButton.disabled = uiState.syncIndex <= 0;
		controls.appendChild(retakeButton);
		controls.appendChild(createButton("♫ Проигрыш", markBreakDuringSync));
		controls.appendChild(createButton("Отмена", () => uiState.navigation.closeEditor(), "ml-auto"));
		uiState.content.appendChild(top);
		uiState.content.appendChild(previous);
		uiState.content.appendChild(mainLine);
		uiState.content.appendChild(nextLines);
		uiState.content.appendChild(hint);
		uiState.content.appendChild(controls);
		playSyncShift(before, direction);
		updateSyncAnimation(currentTime, progress, playPauseButton);
	}
	function clearSyncAnimation() {
		if (uiState.syncAnimationFrame) {
			window.cancelAnimationFrame(uiState.syncAnimationFrame);
			uiState.syncAnimationFrame = 0;
		}
	}
	function updateSyncPlayButton(button) {
		button.textContent = isPlaying() ? "⏸ Пауза" : "▶ Играть";
	}
	function updateSyncAnimation(timeElement, progressElement, playPauseButton) {
		clearSyncAnimation();
		let lastPosition = null;
		const update = () => {
			if (uiState.currentMode !== "sync") {
				uiState.syncAnimationFrame = 0;
				return;
			}
			const position = getProgressSeconds();
			if (trackJustRestarted(lastPosition, position, uiState.currentTrack?.duration) && isPlaying()) {
				pause();
				showToast("Трек дошёл до конца", "info", "Музыка на паузе. Перемотай назад и продолжай.");
			}
			lastPosition = position;
			timeElement.textContent = formatTime(position ?? 0);
			progressElement.textContent = progressLabel();
			updateSyncPlayButton(playPauseButton);
			uiState.syncAnimationFrame = window.requestAnimationFrame(update);
		};
		uiState.syncAnimationFrame = window.requestAnimationFrame(update);
	}
	function retakeCurrentSyncLine() {
		if (uiState.currentMode !== "sync" || !uiState.currentTrack) return;
		const result = retakeLastLine(uiState.syncLines, uiState.syncIndex);
		if (!result) return;
		const wasPlaying = isPlaying();
		if (wasPlaying) pause();
		uiState.syncIndex = result.index;
		setProgress(Math.max(0, result.position - 2));
		saveCurrentDraft();
		renderSyncScreen();
		if (wasPlaying) play();
	}
	function dropInvalidEndMarker() {
		const lines = uiState.syncLines;
		const last = getLastTextLineIndex(lines);
		const end = getEndMarkerIndex(lines);
		if (last < 0 || end < 0) return;
		const lastTime = lines[last].time;
		const endTime = lines[end].time;
		if (lastTime !== null && endTime !== null && endTime <= lastTime + .05) lines.splice(end, 1);
	}
	function finishMarking() {
		clearSyncAnimation();
		pause();
		dropInvalidEndMarker();
		let earliestChangedIndex = uiState.syncLines.length;
		for (let i = 0; i < uiState.syncLines.length; i++) {
			const line = uiState.syncLines[i];
			if (line.isBreak) continue;
			const oldTime = uiState.reviewReturnTimes.get(line);
			if (uiState.reviewReturnTimes.has(line) && oldTime !== line.time) {
				earliestChangedIndex = i;
				break;
			}
		}
		uiState.reviewIndex = Math.min(uiState.reviewReturnIndex, earliestChangedIndex);
		uiState.navigation.showReviewScreen(false, true);
	}
	function markBreakDuringSync() {
		if (uiState.currentMode !== "sync" || !uiState.currentTrack) return;
		const index = uiState.syncIndex;
		const time = getProgressSeconds();
		if (time === null) return;
		const previous = uiState.syncLines[index - 1];
		if (!previous) {
			showToast("Проигрыш пока нельзя поставить", "warning", "Сначала поставь метку на первой строке.");
			return;
		}
		const wasBreak = previous.isBreak === true;
		const textLine = uiState.syncLines[wasBreak ? index - 2 : index - 1];
		if (!textLine || textLine.time === null || time <= textLine.time + .2) {
			showToast("Проигрыш слишком рано", "warning", "Он должен начаться позже начала предыдущей строки.");
			return;
		}
		if (wasBreak) previous.time = time;
		else {
			uiState.syncLines.splice(index, 0, {
				text: "",
				time,
				isBreak: true
			});
			uiState.syncIndex += 1;
		}
		saveCurrentDraft();
		showToast(wasBreak ? "Проигрыш изменён" : "Проигрыш поставлен", wasBreak ? "info" : "success", `После «${textLine.text}» · ${formatTime(time)}`);
		renderSyncScreen();
	}
	function markCurrentLine() {
		if (uiState.currentMode !== "sync" || uiState.syncIndex >= uiState.syncLines.length || !uiState.currentTrack) return;
		const time = getProgressSeconds();
		if (time === null) return;
		uiState.syncLines[uiState.syncIndex].time = time;
		uiState.syncIndex += 1;
		while (uiState.syncIndex < uiState.syncLines.length && uiState.syncLines[uiState.syncIndex].isBreak) uiState.syncIndex += 1;
		saveCurrentDraft();
		if (uiState.syncIndex >= uiState.syncLines.length) {
			finishMarking();
			return;
		}
		renderSyncScreen();
	}
	function returnToSyncEditing() {
		if (uiState.currentMode !== "review" || !uiState.syncLines.length) return;
		clearPreviewTimers();
		if (isPlaying()) pause();
		uiState.reviewReturnIndex = uiState.reviewIndex;
		uiState.reviewReturnTimes = /* @__PURE__ */ new WeakMap();
		uiState.syncLines.forEach((line) => {
			uiState.reviewReturnTimes.set(line, line.time);
		});
		let lastTextIndex = -1;
		for (let i = uiState.syncLines.length - 1; i >= 0; i -= 1) {
			const line = uiState.syncLines[i];
			if (!line.isBreak && line.time !== null) {
				lastTextIndex = i;
				break;
			}
		}
		if (lastTextIndex < 0) return;
		uiState.syncIndex = lastTextIndex;
		uiState.currentMode = "sync";
		renderSyncScreen();
		const lastTime = uiState.syncLines[lastTextIndex].time;
		if (lastTime !== null) setProgress(Math.max(0, lastTime - .5));
		play();
	}
	//#endregion
	//#region src/ui/break-screen.ts
	function startBreakForLine(index, returnMode) {
		if (!uiState.currentTrack || !uiState.syncLines[index] || uiState.syncLines[index].isBreak) return;
		const range = getBreakRange(uiState.syncLines, index, uiState.currentTrack.duration);
		if (!range) return;
		uiState.reviewIndex = index;
		clearPreviewTimers();
		if (isPlaying()) pause();
		uiState.playbackControlActive = true;
		uiState.currentMode = returnMode === "review" ? "review-break" : "resync-break";
		renderBreakMarkerScreen(returnMode, range.min, range.max);
		const durationSec = range.max - range.min;
		const runId = uiState.previewRunId;
		uiState.breakStartTimer = window.setTimeout(() => {
			uiState.breakStartTimer = null;
			if (runId !== uiState.previewRunId) return;
			setProgress(range.min);
			play();
			if (durationSec > 0) uiState.breakStopTimer = window.setTimeout(() => {
				uiState.breakStopTimer = null;
				if (runId !== uiState.previewRunId) return;
				if (isPlaying()) pause();
				updateBreakMarkerClock();
			}, durationSec * 1e3);
		}, 50);
	}
	function renderBreakMarkerScreen(returnMode = "resync", minTime, maxTime) {
		if (!uiState.content || !uiState.currentTrack) return;
		uiState.currentMode = returnMode === "review" ? "review-break" : "resync-break";
		setContent();
		const status = setStatus("Поставь метку в момент, когда начинается проигрыш. До следующей строки текст подсвечиваться не будет.");
		const time = document.createElement("div");
		time.id = "hokensync-break-current-time";
		time.textContent = formatTime(getProgressSeconds() ?? 0);
		const hint = document.createElement("div");
		hint.id = "hokensync-break-hint";
		hint.textContent = returnMode === "review" ? "Enter – установить проигрыш после строки | Space – повторить/стоп | ← / → ±5 с | ESC – назад" : "Enter – установить проигрыш | Space – повторить/стоп | ← / → ±5 с | ESC – назад";
		const buttons = document.createElement("div");
		buttons.id = "hokensync-buttons";
		const repeatBtn = createButton(isPlaying() ? "⏹ Стоп" : "▶ Повторить", () => {
			if (isPlaying()) {
				clearPreviewTimers();
				pause();
				repeatBtn.textContent = "▶ Повторить";
				updateBreakMarkerClock();
			} else startBreakForLine(uiState.reviewIndex, returnMode);
		});
		repeatBtn.id = "hokensync-repeat-btn";
		buttons.appendChild(repeatBtn);
		buttons.appendChild(createButton("−5 с", () => skipBackward(5)));
		buttons.appendChild(createButton("+5 с", () => skipForward(5)));
		buttons.appendChild(createButton("♫ Поставить проигрыш", () => markBreakAtCurrentTime(minTime, maxTime), "primary"));
		buttons.appendChild(createButton("Назад", () => {
			clearPreviewTimers();
			if (isPlaying()) pause();
			if (returnMode === "review") uiState.navigation.showReviewScreen(false, true);
			else uiState.navigation.showResyncList();
		}, "ml-auto"));
		uiState.content.appendChild(status);
		uiState.content.appendChild(time);
		uiState.content.appendChild(hint);
		uiState.content.appendChild(buttons);
		updateBreakMarkerClock();
	}
	function updateBreakMarkerClock() {
		if (uiState.breakClockFrame) window.cancelAnimationFrame(uiState.breakClockFrame);
		let lastPosition = null;
		const update = () => {
			if (uiState.currentMode !== "resync-break" && uiState.currentMode !== "review-break") {
				uiState.breakClockFrame = 0;
				return;
			}
			const position = getProgressSeconds();
			if (trackJustRestarted(lastPosition, position, uiState.currentTrack?.duration) && isPlaying()) pause();
			lastPosition = position;
			const time = document.getElementById("hokensync-break-current-time");
			if (time) time.textContent = formatTime(getProgressSeconds() ?? 0);
			const repeatBtn = document.getElementById("hokensync-repeat-btn");
			if (repeatBtn) {
				const expectedText = isPlaying() ? "⏹ Стоп" : "▶ Повторить";
				if (repeatBtn.textContent !== expectedText) repeatBtn.textContent = expectedText;
			}
			uiState.breakClockFrame = window.requestAnimationFrame(update);
		};
		uiState.breakClockFrame = window.requestAnimationFrame(update);
	}
	function markBreakAtCurrentTime(minTime, maxTime) {
		if (uiState.currentMode !== "resync-break" && uiState.currentMode !== "review-break" || !uiState.currentTrack) return;
		const position = getProgressSeconds();
		if (position === null) return;
		const status = document.getElementById("hokensync-status");
		if (typeof minTime === "number" && position <= minTime) {
			if (status) {
				status.textContent = "Сначала дождись окончания этой строки.";
				status.className = "hokensync-status-error";
			}
			return;
		}
		if (typeof maxTime === "number" && Number.isFinite(maxTime) && position >= maxTime) {
			if (status) {
				status.textContent = "Момент проигрыша должен быть до следующей строки.";
				status.className = "hokensync-status-error";
			}
			return;
		}
		if (uiState.currentMode === "review-break") {
			const range = getBreakRange(uiState.syncLines, uiState.reviewIndex, uiState.currentTrack.duration);
			if (!range || position <= range.min || position >= range.max) {
				if (status) {
					status.textContent = "Момент проигрыша должен находиться после этой строки и до следующей.";
					status.className = "hokensync-status-error";
				}
				return;
			}
			const hadBreak = getBreakAfterLineIndex(uiState.syncLines, uiState.reviewIndex) >= 0;
			if (setBreakAfterLine(uiState.syncLines, uiState.reviewIndex, position) === null) return;
			pause();
			uiState.syncIndex = uiState.syncLines.length;
			saveCurrentDraft();
			showToast(hadBreak ? "Проигрыш изменён" : "Проигрыш добавлен", hadBreak ? "info" : "success", `Начало: ${formatTime(position)}`);
			if (uiState.breakClockFrame) {
				window.cancelAnimationFrame(uiState.breakClockFrame);
				uiState.breakClockFrame = 0;
			}
			uiState.navigation.showReviewScreen(false, true);
			return;
		}
		const targetIndex = uiState.reviewIndex < uiState.syncLines.length && !uiState.syncLines[uiState.reviewIndex]?.isBreak ? uiState.reviewIndex : getPreviousTextLineIndex(uiState.syncLines, uiState.reviewIndex + 1);
		const range = targetIndex >= 0 ? getBreakRange(uiState.syncLines, targetIndex, uiState.currentTrack.duration) : null;
		if (!range || position <= range.min || position >= range.max) {
			if (status) {
				status.textContent = "Момент проигрыша должен находиться после выбранной строки и до следующей.";
				status.className = "hokensync-status-error";
			}
			return;
		}
		const hadBreak = getBreakAfterLineIndex(uiState.syncLines, targetIndex) >= 0;
		if (setBreakAfterLine(uiState.syncLines, targetIndex, position) === null) return;
		pause();
		uiState.reviewIndex = targetIndex;
		saveCurrentLyrics();
		showToast(hadBreak ? "Проигрыш изменён" : "Проигрыш добавлен", hadBreak ? "info" : "success", `Начало: ${formatTime(position)}`);
		if (uiState.breakClockFrame) {
			window.cancelAnimationFrame(uiState.breakClockFrame);
			uiState.breakClockFrame = 0;
		}
		uiState.navigation.showResyncList();
	}
	//#endregion
	//#region src/ui/resync-screen.ts
	function startSavedResync(saved) {
		const lines = parseLrc(saved.lrc);
		if (!lines.length || !uiState.currentTrack) return;
		clearPreviewTimers();
		uiState.syncLines = lines.map((line) => ({ ...line }));
		uiState.sections = (saved.sections ?? []).map((mark) => ({ ...mark }));
		uiState.syncIndex = 0;
		uiState.reviewIndex = 0;
		deleteDraft(uiState.currentTrack.artist, uiState.currentTrack.title);
		renderResyncList();
	}
	var pendingScrollTop = 0;
	function rememberScroll() {
		pendingScrollTop = document.getElementById("hokensync-resync-list")?.scrollTop ?? 0;
	}
	function createToolButton(kind, onClick) {
		const button = createButton("", onClick, `hokensync-tool-btn ${kind === "add" ? "hokensync-tool-add" : "hokensync-tool-delete"}`);
		button.innerHTML = kind === "add" ? ICONS.plus : ICONS.trash;
		button.setAttribute("aria-label", kind === "add" ? "Добавить после этой строки" : "Удалить строку");
		return button;
	}
	function beginInsertAfter(row, index) {
		if (document.querySelector(".hokensync-resync-new")) return;
		const newRow = document.createElement("div");
		newRow.className = "hokensync-resync-row hokensync-resync-new";
		const number = document.createElement("div");
		number.className = "hokensync-resync-num";
		const time = document.createElement("div");
		time.className = "hokensync-resync-time";
		time.textContent = "новая";
		const cell = document.createElement("div");
		cell.className = "hokensync-resync-text";
		const input = createLineInput("", "Текст новой строки, Enter — добавить", (value) => {
			rememberScroll();
			const created = insertLineAfter(index, value);
			if (created >= 0) startResyncLine(created);
			else renderResyncList();
		}, () => {
			rememberScroll();
			renderResyncList();
		});
		cell.appendChild(input);
		newRow.appendChild(number);
		newRow.appendChild(time);
		newRow.appendChild(cell);
		row.after(newRow);
		input.focus();
	}
	function openAddMenu(anchor, row, index) {
		openChoiceMenu(anchor, [
			{
				label: "Добавить строку ниже",
				plain: true,
				onPick: () => beginInsertAfter(row, index)
			},
			{
				label: "Метка части — над этой строкой",
				heading: true,
				separator: true,
				onPick: () => {}
			},
			...SECTION_LABELS.map((label) => ({
				label,
				onPick: () => {
					rememberScroll();
					insertSectionBefore(index, label);
					renderResyncList();
				}
			}))
		]);
	}
	function openChangeLabelMenu(anchor, position) {
		openChoiceMenu(anchor, [{
			label: `Сейчас: ${uiState.sections[position]?.label ?? ""}`,
			heading: true,
			onPick: () => {}
		}, ...SECTION_LABELS.map((label) => ({
			label,
			onPick: () => {
				rememberScroll();
				replaceSection(position, label);
				renderResyncList();
			}
		}))]);
	}
	function confirmRemove(index) {
		const line = uiState.syncLines[index];
		if (!line) return;
		showDeleteConfirm(() => {
			rememberScroll();
			removeLine(index);
			renderResyncList();
		}, {
			title: "Удалить строку?",
			descriptionBefore: "Строка ",
			highlightedText: `«${line.text}»`,
			descriptionAfter: " будет удалена из текста.",
			icon: "🥺"
		});
	}
	function createSectionRow(position) {
		const row = document.createElement("div");
		row.className = "hokensync-resync-section";
		const icon = document.createElement("span");
		icon.className = "hokensync-resync-section-icon";
		icon.innerHTML = ICONS.tag;
		const label = document.createElement("span");
		label.className = "hokensync-resync-section-label";
		label.textContent = uiState.sections[position].label;
		const line = document.createElement("span");
		line.className = "hokensync-resync-section-line";
		const tools = document.createElement("div");
		tools.className = "hokensync-resync-section-tools";
		const change = createButton("", () => openChangeLabelMenu(change, position), "hokensync-tool-btn hokensync-tool-label");
		change.innerHTML = ICONS.pencil;
		change.setAttribute("aria-label", "Изменить метку");
		const remove = createButton("", () => {
			rememberScroll();
			removeSectionAt(position);
			renderResyncList();
		}, "hokensync-tool-btn hokensync-tool-delete hokensync-tool-section");
		remove.innerHTML = ICONS.trash;
		remove.setAttribute("aria-label", "Удалить метку");
		tools.appendChild(change);
		tools.appendChild(remove);
		row.appendChild(icon);
		row.appendChild(label);
		row.appendChild(line);
		row.appendChild(tools);
		return row;
	}
	function createShiftPanel() {
		const panel = document.createElement("div");
		const title = document.createElement("div");
		const row = document.createElement("div");
		const input = document.createElement("input");
		const unit = document.createElement("span");
		const info = document.createElement("div");
		panel.id = "hokensync-shift-panel";
		panel.hidden = true;
		title.className = "hokensync-shift-title";
		title.textContent = "Сместить все таймкоды";
		row.className = "hokensync-shift-row";
		input.type = "text";
		input.inputMode = "decimal";
		input.className = "hokensync-line-input hokensync-shift-input";
		input.placeholder = "0.00";
		input.autocomplete = "off";
		input.spellcheck = false;
		unit.className = "hokensync-shift-unit";
		unit.textContent = "с";
		info.className = "hokensync-shift-info";
		const parseDelta = () => {
			const text = input.value.trim().replace(",", ".").replace(/^\+/, "");
			if (!text) return null;
			const value = Number(text);
			return Number.isFinite(value) ? value : null;
		};
		const signed = (value) => `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)} с`;
		const apply = createButton("Сместить", () => submit(), "primary");
		const cancel = createButton("Отмена", () => {
			panel.hidden = true;
		});
		const refreshInfo = () => {
			const delta = parseDelta();
			const times = uiState.syncLines.map((line) => line.time).filter((time) => typeof time === "number");
			info.classList.remove("bad", "warn");
			if (delta === null || !times.length) {
				info.textContent = "Введи число секунд: положительное сдвигает текст позже, отрицательное — раньше.";
				apply.disabled = true;
				return;
			}
			const first = Math.min(...times);
			const last = Math.max(...times);
			if (first + delta < -1e-4) {
				info.textContent = `Так нельзя: самый ранний таймкод ${formatTime(first)} уйдёт раньше начала трека. Больше можно сдвинуть назад на ${first.toFixed(2)} с.`;
				info.classList.add("bad");
				apply.disabled = true;
				return;
			}
			const duration = uiState.currentTrack?.duration;
			const over = typeof duration === "number" && duration > 0 && last + delta > duration;
			info.textContent = `Первый таймкод: ${formatTime(first)} → ${formatTime(first + delta)}. Последний: ${formatTime(last)} → ${formatTime(last + delta)}.` + (over ? " Последний таймкод выйдет за конец трека." : "");
			if (over) info.classList.add("warn");
			apply.disabled = delta === 0;
		};
		const submit = () => {
			const delta = parseDelta();
			if (delta === null || delta === 0) return;
			if (!shiftAllTimes(uiState.syncLines, delta)) {
				showToast("Сдвиг невозможен", "warning", "Самый ранний таймкод ушёл бы раньше начала трека.");
				return;
			}
			saveResyncLyrics();
			showToast("Таймкоды сдвинуты", "success", `Все метки времени сдвинуты на ${signed(delta)}.`);
			rememberScroll();
			renderResyncList();
		};
		for (const step of [
			-1,
			-.5,
			-.1,
			.1,
			.5,
			1
		]) {
			row.appendChild(createButton(step > 0 ? `+${step}` : `−${Math.abs(step)}`, () => {
				const next = Math.round(((parseDelta() ?? 0) + step) * 100) / 100;
				input.value = String(next);
				refreshInfo();
				input.focus();
			}));
			if (step === -.1) {
				row.appendChild(input);
				row.appendChild(unit);
			}
		}
		const actions = document.createElement("div");
		actions.className = "hokensync-shift-actions";
		actions.appendChild(apply);
		actions.appendChild(cancel);
		row.appendChild(actions);
		input.addEventListener("input", refreshInfo);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				submit();
			} else if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				panel.hidden = true;
			}
		});
		panel.appendChild(title);
		panel.appendChild(row);
		panel.appendChild(info);
		refreshInfo();
		return {
			element: panel,
			toggle: () => {
				panel.hidden = !panel.hidden;
				if (!panel.hidden) {
					refreshInfo();
					input.focus();
					input.select();
				}
			}
		};
	}
	function renderResyncList() {
		if (!uiState.content) return;
		const cameFromEditing = uiState.currentMode === "resync-review" || uiState.currentMode === "resync-break";
		uiState.currentMode = "resync";
		setContent();
		const status = setStatus("Выбери строку для правки или поставь точку начала проигрыша. В проигрыше текст подсвечиваться не будет.");
		const list = document.createElement("div");
		list.id = "hokensync-resync-list";
		list.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
		const startButton = createButton("", () => beginInsertAfter(startButton, -1), "hokensync-resync-start");
		startButton.innerHTML = `<span class="hokensync-resync-start-label">${ICONS.plus}Добавить строку в начало</span>`;
		list.appendChild(startButton);
		const endIndex = getEndMarkerIndex(uiState.syncLines);
		const lastTextIndex = getLastTextLineIndex(uiState.syncLines);
		const appendSections = (before) => {
			uiState.sections.forEach((mark, position) => {
				if (mark.before === before) list.appendChild(createSectionRow(position));
			});
		};
		let ordinal = 0;
		uiState.syncLines.forEach((line, index) => {
			if (index === endIndex) return;
			if (!line.isBreak) {
				appendSections(ordinal);
				ordinal += 1;
			}
			const row = document.createElement("div");
			row.className = line.isBreak ? "hokensync-resync-row hokensync-resync-break-row" : "hokensync-resync-row";
			row.dataset.lineIndex = String(index);
			const number = document.createElement("div");
			number.className = "hokensync-resync-num";
			number.textContent = line.isBreak ? "" : String(ordinal);
			const time = document.createElement("div");
			time.className = "hokensync-resync-time";
			time.textContent = formatTime(line.time ?? 0);
			const text = document.createElement("div");
			text.className = "hokensync-resync-text";
			text.textContent = line.isBreak ? "♫  ПРОИГРЫШ — подсветка выключена" : line.text;
			if (index === lastTextIndex) {
				const endLabel = document.createElement("div");
				endLabel.className = "hokensync-resync-end";
				endLabel.textContent = endIndex >= 0 ? `Конец: ${formatTime(uiState.syncLines[endIndex].time ?? 0)}` : "Конец не задан";
				text.appendChild(endLabel);
			}
			row.appendChild(number);
			row.appendChild(time);
			row.appendChild(text);
			if (line.isBreak) {
				const removeButton = createButton("Удалить", () => {
					removeBreakMarker(uiState.syncLines, index);
					saveResyncLyrics();
					showToast("Проигрыш удалён", "delete", "Подсветка строки снова продлится до следующей.");
					renderResyncList();
				}, "danger hokensync-resync-delete");
				setFixedActionWidth(removeButton);
				row.appendChild(removeButton);
			} else {
				const actions = document.createElement("div");
				actions.className = "hokensync-resync-actions";
				const editButton = createButton("Изменить", () => startResyncLine(index), "hokensync-resync-edit");
				setFixedActionWidth(editButton);
				actions.appendChild(editButton);
				if (index === lastTextIndex) {
					const endButton = createButton(endIndex >= 0 ? "Изменить конец" : "Задать конец", startResyncEnd, endIndex >= 0 ? "break-edit" : "");
					setFixedActionWidth(endButton);
					actions.appendChild(endButton);
				} else {
					const existingBreak = getBreakAfterLineIndex(uiState.syncLines, index) >= 0;
					const breakButton = createButton(existingBreak ? "Изменить проигрыш" : "♫ Проигрыш после", () => startBreakForLine(index, "resync"), existingBreak ? "break-edit" : "");
					setFixedActionWidth(breakButton);
					actions.appendChild(breakButton);
				}
				const tools = document.createElement("div");
				tools.className = "hokensync-resync-tools";
				const addButton = createToolButton("add", () => openAddMenu(addButton, row, index));
				tools.appendChild(addButton);
				tools.appendChild(createToolButton("remove", () => confirmRemove(index)));
				actions.appendChild(tools);
				row.appendChild(actions);
			}
			list.appendChild(row);
		});
		appendSections(ordinal);
		const shiftPanel = createShiftPanel();
		const buttons = document.createElement("div");
		buttons.id = "hokensync-buttons";
		buttons.appendChild(createButton("Сместить все таймкоды", shiftPanel.toggle));
		buttons.appendChild(createButton("Назад к тексту", () => uiState.navigation.showTextEditor(), "ml-auto"));
		uiState.content.appendChild(status);
		uiState.content.appendChild(shiftPanel.element);
		uiState.content.appendChild(list);
		uiState.content.appendChild(buttons);
		list.scrollTop = pendingScrollTop;
		pendingScrollTop = 0;
		if (cameFromEditing) revealEditedRow(list, lastTextIndex);
	}
	function revealEditedRow(list, lastTextIndex) {
		const wanted = list.querySelector(`[data-line-index="${uiState.reviewIndex}"]`) ?? list.querySelector(`[data-line-index="${lastTextIndex}"]`);
		if (!wanted) return;
		const offset = wanted.getBoundingClientRect().top - list.getBoundingClientRect().top;
		list.scrollTop += offset - list.clientHeight / 2 + wanted.offsetHeight / 2;
		wanted.classList.add("hokensync-resync-row-flash");
		window.setTimeout(() => wanted.classList.remove("hokensync-resync-row-flash"), 1400);
	}
	function setFixedActionWidth(button) {
		button.style.flex = "0 0 140px";
		button.style.width = "140px";
		button.style.minWidth = "140px";
		button.style.maxWidth = "140px";
	}
	function saveResyncLyrics() {
		if (!uiState.currentTrack) return;
		saveCurrentLyrics();
	}
	function startResyncLine(index) {
		if (!uiState.syncLines[index]) return;
		if (isPlaying()) pause();
		clearPreviewTimers();
		uiState.reviewIndex = index;
		rememberReviewLine();
		renderReviewScreen(true);
		window.setTimeout(() => startReviewPreview(), 50);
	}
	function startResyncEnd() {
		if (isPlaying()) pause();
		clearPreviewTimers();
		const index = ensureEndMarker(uiState.syncLines, null, uiState.currentTrack?.duration);
		if (index < 0) return;
		uiState.reviewIndex = index;
		rememberReviewLine();
		renderReviewScreen(true);
		window.setTimeout(() => startReviewPreview(), 50);
	}
	//#endregion
	//#region src/ui/track-guard.ts
	var active = false;
	var guardedTrackId = "";
	var repeatWasChanged = false;
	var previousRepeat;
	var unsubscribe = null;
	var REPEAT_RESTORE_KEY = "hokensync-repeat-restore";
	function rememberRepeat(mode) {
		try {
			localStorage.setItem(REPEAT_RESTORE_KEY, JSON.stringify({ mode: mode ?? "none" }));
		} catch {}
	}
	function forgetRepeat() {
		try {
			localStorage.removeItem(REPEAT_RESTORE_KEY);
		} catch {}
	}
	window.addEventListener("pagehide", () => {
		if (active && repeatWasChanged && getRepeatMode() === "one") setRepeatMode(previousRepeat ?? "none");
	});
	function readTrackId(value) {
		const item = value;
		const id = item?.entity?.data?.meta?.id ?? item?.entity?.entityData?.meta?.id;
		return id === void 0 || id === null ? null : String(id);
	}
	function handleEntityChange(value) {
		if (!active || !uiState.overlay) return;
		const id = readTrackId(value) ?? getCurrentTrack()?.id;
		if (!id || id === guardedTrackId) return;
		const hadDraft = uiState.currentMode === "sync" || uiState.currentMode === "review" || uiState.currentMode === "review-break";
		uiState.playbackControlActive = false;
		uiState.currentMode = "text";
		uiState.navigation.closeEditor();
		pause();
		showToast("Трек сменился", "warning", hadDraft ? "HokenSync закрыт, разметка сохранена в черновике." : "HokenSync закрыт.");
	}
	function startTrackGuard() {
		guardedTrackId = uiState.currentTrack?.id ?? "";
		if (active) return;
		active = true;
		const mode = getRepeatMode();
		if (mode !== "one") {
			previousRepeat = mode;
			repeatWasChanged = true;
			rememberRepeat(mode);
			setRepeatMode("one");
		}
		try {
			const result = window.sonataState?.queueState?.currentEntity?.onChange?.(handleEntityChange);
			if (typeof result === "function") unsubscribe = result;
		} catch (error) {
			console.warn("[HokenSync] Не удалось подписаться на смену трека:", error);
		}
	}
	function stopTrackGuard() {
		if (!active) return;
		active = false;
		unsubscribe?.();
		unsubscribe = null;
		if (repeatWasChanged && getRepeatMode() === "one") setRepeatMode(previousRepeat ?? "none");
		if (repeatWasChanged) forgetRepeat();
		repeatWasChanged = false;
		previousRepeat = void 0;
	}
	function restoreRepeatAfterUnexpectedClose() {
		let previous;
		try {
			const saved = localStorage.getItem(REPEAT_RESTORE_KEY);
			if (!saved) return;
			previous = JSON.parse(saved).mode ?? "none";
		} catch {
			forgetRepeat();
			return;
		}
		const delays = [
			2e3,
			6e3,
			15e3,
			4e4
		];
		const attempt = (index) => {
			if (active) return;
			if (getRepeatMode() === "one") {
				setRepeatMode(previous);
				forgetRepeat();
				return;
			}
			if (index + 1 < delays.length) window.setTimeout(() => attempt(index + 1), delays[index + 1] - delays[index]);
			else forgetRepeat();
		};
		window.setTimeout(() => attempt(0), delays[0]);
	}
	//#endregion
	//#region src/ui/seek.ts
	var STEP_SEC = 3;
	var HOLD_DELAY_MS = 350;
	var TICK_MS = 80;
	var BASE_SPEED = 6;
	var DOUBLING_SEC = 1.5;
	var MAX_SPEED = 150;
	var REUSE_POSITION_MS = 400;
	var direction = 0;
	var heldSince = 0;
	var position = 0;
	var lastSeekAt = 0;
	var timer = null;
	function clampPosition(value) {
		const duration = uiState.currentTrack?.duration;
		const max = typeof duration === "number" && duration > 1 ? duration - .5 : Number.POSITIVE_INFINITY;
		return Math.min(Math.max(0, value), max);
	}
	function seekTo(value) {
		position = clampPosition(value);
		lastSeekAt = Date.now();
		setProgress(position);
	}
	function tick() {
		if (!direction || uiState.currentMode !== "sync") {
			stopSeek();
			return;
		}
		const heldMs = Date.now() - heldSince - HOLD_DELAY_MS;
		if (heldMs <= 0) return;
		const speed = Math.min(MAX_SPEED, BASE_SPEED * Math.pow(2, heldMs / 1e3 / DOUBLING_SEC));
		seekTo(position + direction * speed * (TICK_MS / 1e3));
	}
	function startSeek(next) {
		stopSeek();
		direction = next;
		heldSince = Date.now();
		seekTo((Date.now() - lastSeekAt < REUSE_POSITION_MS ? position : getProgressSeconds() ?? 0) + next * STEP_SEC);
		timer = window.setInterval(tick, TICK_MS);
	}
	function stopSeek() {
		direction = 0;
		if (timer !== null) {
			window.clearInterval(timer);
			timer = null;
		}
	}
	//#endregion
	//#region src/ui/keyboard.ts
	function closeDeleteConfirm$1() {
		uiState.deleteConfirmElement?.remove();
		uiState.deleteConfirmElement = null;
		uiState.deleteConfirmOpen = false;
	}
	function handleKeyUp(event) {
		if (event.code === "ArrowLeft" || event.code === "ArrowRight") stopSeek();
	}
	function handleKeyDown(event) {
		if (!uiState.overlay) return false;
		const target = event.target;
		if (target instanceof HTMLInputElement && target.classList.contains("hokensync-line-input")) return false;
		if (event.key === "Escape" && closeChoiceMenu()) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return true;
		}
		if (isChoiceMenuOpen() && /^(Digit|Numpad)[0-9]$/.test(event.code)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			pickChoiceByNumber(Number(event.code.slice(-1)));
			return true;
		}
		if (uiState.deleteConfirmOpen) {
			event.preventDefault();
			event.stopImmediatePropagation();
			if (event.key === "Escape") closeDeleteConfirm$1();
			return true;
		}
		if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyS" && uiState.currentMode === "text") {
			const tagButton = document.querySelector(".hokensync-tag-btn");
			if (tagButton) {
				event.preventDefault();
				event.stopImmediatePropagation();
				tagButton.click();
				return true;
			}
		}
		if (event.key === "Escape" && uiState.currentMode === "text" && document.activeElement instanceof HTMLTextAreaElement) return false;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopImmediatePropagation();
			if (uiState.currentMode === "resync-review") {
				clearPreviewTimers();
				if (isPlaying()) pause();
				uiState.playbackControlActive = false;
				discardReviewChanges();
				renderResyncList();
				return true;
			}
			if (uiState.currentMode === "resync-break" || uiState.currentMode === "review-break") {
				clearPreviewTimers();
				if (isPlaying()) pause();
				if (uiState.currentMode === "review-break") uiState.navigation.showReviewScreen(false, true);
				else renderResyncList();
				return true;
			}
			uiState.navigation.closeEditor();
			return true;
		}
		if (uiState.currentMode === "sync") {
			if (event.key === "Enter") {
				event.preventDefault();
				event.stopImmediatePropagation();
				markCurrentLine();
				return true;
			}
			if (event.code === "Space") {
				event.preventDefault();
				event.stopImmediatePropagation();
				togglePlayPause();
				return true;
			}
			if (event.code === "KeyB") {
				event.preventDefault();
				event.stopImmediatePropagation();
				markBreakDuringSync();
				return true;
			}
			if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (!event.repeat) startSeek(event.code === "ArrowLeft" ? -1 : 1);
				return true;
			}
			if (event.key === "Backspace") {
				event.preventDefault();
				event.stopImmediatePropagation();
				retakeCurrentSyncLine();
				return true;
			}
		}
		if (uiState.currentMode === "resync-break" || uiState.currentMode === "review-break") {
			if (event.key === "Enter") {
				event.preventDefault();
				event.stopImmediatePropagation();
				markBreakAtCurrentTime();
				return true;
			}
			if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (event.code === "ArrowLeft") skipBackward(5);
				else skipForward(5);
				return true;
			}
			if (event.code === "Space") {
				event.preventDefault();
				event.stopImmediatePropagation();
				document.getElementById("hokensync-repeat-btn")?.click();
				return true;
			}
			if (event.key === "Backspace") {
				event.preventDefault();
				event.stopImmediatePropagation();
				clearPreviewTimers();
				if (isPlaying()) pause();
				if (uiState.currentMode === "review-break") uiState.navigation.showReviewScreen(false, true);
				else renderResyncList();
				return true;
			}
		}
		if (uiState.currentMode === "review" || uiState.currentMode === "resync-review") {
			if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
				event.preventDefault();
				event.stopImmediatePropagation();
				const isResync = uiState.currentMode === "resync-review";
				const amount = event.shiftKey ? .05 : .1;
				adjustReviewTime(event.code === "ArrowLeft" ? -amount : amount, isResync);
				return true;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				event.stopImmediatePropagation();
				acceptReviewLine();
				return true;
			}
			if (event.code === "Space") {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (uiState.previewPlaying) stopReviewPreview();
				window.setTimeout(() => startReviewPreview(), 50);
				return true;
			}
			if (event.key === "Backspace") {
				event.preventDefault();
				event.stopImmediatePropagation();
				goToPreviousReviewLine();
				return true;
			}
		}
		return false;
	}
	//#endregion
	//#region src/ui/ui.ts
	var OVERLAY_ID = "hokensync-overlay";
	function configureNavigation() {
		uiState.navigation.closeEditor = closeEditor;
		uiState.navigation.showLyricsMenu = () => {
			renderLyricsMenu();
		};
		uiState.navigation.showSavedLyricsList = () => {
			renderSavedLyricsList();
		};
		uiState.navigation.showTextEditor = renderTextEditor;
		uiState.navigation.showSyncScreen = renderSyncScreen;
		uiState.navigation.showReviewScreen = (isResync = false, startPreview = false) => {
			renderReviewScreen(isResync);
			if (startPreview) startReviewPreview();
		};
		uiState.navigation.showResyncList = renderResyncList;
		uiState.navigation.startSavedResync = startSavedResync;
		uiState.navigation.showDoneScreen = renderDoneScreen;
		uiState.navigation.startSynchronization = startSynchronization;
		uiState.navigation.returnToSyncEditing = returnToSyncEditing;
		uiState.navigation.startBreakForLine = startBreakForLine;
	}
	function stopSyncAnimation() {
		if (uiState.syncAnimationFrame) {
			window.cancelAnimationFrame(uiState.syncAnimationFrame);
			uiState.syncAnimationFrame = 0;
		}
	}
	function closeDeleteConfirm() {
		uiState.deleteConfirmElement?.remove();
		uiState.deleteConfirmElement = null;
		uiState.deleteConfirmOpen = false;
	}
	function closeEditor() {
		const overlayElement = document.getElementById(OVERLAY_ID);
		if (!overlayElement || overlayElement.dataset.closing === "true") return;
		overlayElement.dataset.closing = "true";
		overlayElement.style.pointerEvents = "none";
		const shouldRestorePlayback = uiState.playbackControlActive;
		stopTrackGuard();
		stopSyncAnimation();
		clearPreviewTimers();
		if (uiState.currentMode === "review" || uiState.currentMode === "resync-review" || uiState.currentMode === "review-break") stopReviewPreview();
		else uiState.previewPlaying = false;
		if (shouldRestorePlayback) {
			setProgress(uiState.playbackPositionBeforeOpen);
			if (uiState.playbackWasPlayingBeforeOpen) play();
			else pause();
		}
		uiState.playbackControlActive = false;
		uiState.previewPlaying = false;
		closeDeleteConfirm();
		uiState.currentMode = "text";
		uiState.syncLines = [];
		uiState.sections = [];
		uiState.syncIndex = 0;
		uiState.reviewIndex = 0;
		uiState.reviewReturnIndex = 0;
		uiState.reviewReturnTimes = /* @__PURE__ */ new WeakMap();
		uiState.playbackWasPlayingBeforeOpen = false;
		uiState.playbackPositionBeforeOpen = 0;
		overlayElement.classList.add("hokensync-closing");
		window.setTimeout(() => {
			overlayElement.remove();
			if (uiState.overlay === overlayElement) {
				uiState.overlay = null;
				uiState.content = null;
				uiState.currentTrack = null;
			}
		}, 240);
	}
	function openShell() {
		if (!uiState.currentTrack) return;
		uiState.overlay?.remove();
		const overlay = document.createElement("div");
		overlay.id = OVERLAY_ID;
		uiState.overlay = overlay;
		const windowElement = document.createElement("div");
		windowElement.id = "hokensync-window";
		const header = document.createElement("div");
		header.id = "hokensync-header";
		const copy = document.createElement("div");
		copy.id = "hokensync-header-copy";
		const title = document.createElement("div");
		title.id = "hokensync-title";
		title.textContent = "HokenSync — синхронизация текста";
		const subtitle = document.createElement("div");
		subtitle.id = "hokensync-subtitle";
		subtitle.textContent = `${uiState.currentTrack.artist || "Неизвестный исполнитель"} — ${uiState.currentTrack.title}`;
		const closeButton = document.createElement("button");
		closeButton.className = "hokensync-close";
		closeButton.type = "button";
		closeButton.innerHTML = ICONS.close;
		closeButton.setAttribute("aria-label", "Закрыть");
		closeButton.title = "Закрыть";
		closeButton.addEventListener("click", closeEditor);
		const headerActions = document.createElement("div");
		headerActions.id = "hokensync-header-actions";
		copy.appendChild(title);
		copy.appendChild(subtitle);
		header.appendChild(copy);
		headerActions.appendChild(closeButton);
		header.appendChild(headerActions);
		const content = document.createElement("div");
		content.id = "hokensync-content";
		uiState.content = content;
		content.addEventListener("scroll", (event) => revealScrollbar(event.target), {
			capture: true,
			passive: true
		});
		installSmoothWheel(content);
		windowElement.appendChild(header);
		windowElement.appendChild(content);
		overlay.appendChild(windowElement);
		installTooltips(overlay);
		let backdropPointerDown = false;
		overlay.addEventListener("pointerdown", (event) => {
			backdropPointerDown = event.target === overlay;
		});
		overlay.addEventListener("pointerup", (event) => {
			if (event.target !== overlay) backdropPointerDown = false;
		});
		overlay.addEventListener("pointercancel", () => {
			backdropPointerDown = false;
		});
		overlay.addEventListener("click", (event) => {
			const shouldClose = event.target === overlay && backdropPointerDown;
			backdropPointerDown = false;
			if (shouldClose) closeEditor();
		});
		document.body.appendChild(overlay);
	}
	function openUi() {
		const existingOverlay = document.getElementById(OVERLAY_ID);
		if (existingOverlay && existingOverlay.dataset.closing !== "true") return;
		const track = getCurrentTrack();
		if (!track || !track.title) {
			console.warn("[HokenSync] Не удалось определить текущий трек.");
			showToast("Нет текущей песни", "warning", "Включи песню в плеере и открой HokenSync снова.");
			return;
		}
		uiState.currentTrack = track;
		uiState.playbackWasPlayingBeforeOpen = isPlaying();
		uiState.playbackPositionBeforeOpen = getProgressSeconds() ?? 0;
		uiState.playbackControlActive = false;
		uiState.previewPlaying = false;
		openShell();
		startTrackGuard();
		renderLyricsMenu();
	}
	configureNavigation();
	//#endregion
	//#region src/ui/player-button.ts
	var PLAYER_BAR = "[data-test-id=\"PLAYERBAR_DESKTOP\"]";
	var QUEUE_BUTTON = "[data-test-id=\"PLAYERBAR_DESKTOP_PLAY_QUEUE_BUTTON\"]";
	var SYNC_LYRICS_BUTTON = "[data-test-id=\"PLAYERBAR_DESKTOP_SYNC_LYRICS_BUTTON\"]";
	var OWN_ATTRIBUTE = "data-hokensync-open";
	var ICON_SHAPES = `<defs><linearGradient id="hokensync-hs-grad" x1="0" y1="0" x2="1" y2="1" spreadMethod="reflect"><stop offset="0" stop-color="#fff1b8"/><stop offset=".45" stop-color="#ffc25a"/><stop offset=".8" stop-color="#ff8a5c"/><stop offset="1" stop-color="#ff6f91"/><animateTransform attributeName="gradientTransform" type="translate" values="-0.5 -0.5;0.5 0.5;-0.5 -0.5" dur="5s" repeatCount="indefinite"/></linearGradient><mask id="hokensync-hs-mask-h" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="11.14" r="1.95" fill="#000"/></mask><mask id="hokensync-hs-mask-s" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/><circle cx="12" cy="15.97" r="1.95" fill="#000"/></mask></defs><g transform="translate(12 12) scale(.95) translate(-12.2 -12.8)" style="stroke:url(#hokensync-hs-grad)"><g mask="url(#hokensync-hs-mask-s)"><path d="M20.2 13.2C19.4 11.6 17.8 10.6 15.6 10.6C12.2 10.6 9.2 11.9 9.2 13.8C9.2 17.4 20.4 15.6 20.4 19C20.4 20.8 18.4 22.1 15.6 22.1C13 22.1 11 21.2 10.2 19.6"/></g><g mask="url(#hokensync-hs-mask-h)"><path d="M4 3.5v10.5M12 3.5v13.3M4 8.6h8"/></g></g>`;
	function findQueueButton() {
		return document.querySelector(`${PLAYER_BAR} ${QUEUE_BUTTON}`) ?? document.querySelector(QUEUE_BUTTON);
	}
	function cloneQueueButton(queue, attribute, testId, label) {
		const button = queue.cloneNode(true);
		button.setAttribute(attribute, "true");
		button.setAttribute("data-test-id", testId);
		button.setAttribute("aria-label", label);
		button.setAttribute("aria-hidden", "false");
		button.setAttribute("type", "button");
		button.removeAttribute("title");
		for (const name of [
			"id",
			"aria-pressed",
			"aria-expanded",
			"aria-haspopup",
			"aria-controls",
			"disabled",
			"aria-disabled"
		]) button.removeAttribute(name);
		button.disabled = false;
		return button;
	}
	function insertButton(openUi) {
		const lyrics = document.querySelector(`${PLAYER_BAR} ${SYNC_LYRICS_BUTTON}`);
		const anchor = lyrics ?? findQueueButton();
		if (!anchor || !anchor.parentElement) return;
		const existing = document.querySelector(`[${OWN_ATTRIBUTE}]`);
		if (existing) {
			if (lyrics && lyrics.nextElementSibling !== existing) lyrics.after(existing);
			return;
		}
		const button = cloneQueueButton(anchor, OWN_ATTRIBUTE, "HOKENSYNC_OPEN_BUTTON", "Открыть HokenSync");
		const svg = button.querySelector("svg");
		if (svg) {
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("style", "fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round");
			svg.innerHTML = ICON_SHAPES;
		}
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			openUi();
		});
		attachTooltip(button, "HokenSync", "Тексты песен: добавить и править.", [
			"Ctrl",
			"Alt",
			"L"
		]);
		if (lyrics) lyrics.after(button);
		else anchor.before(button);
	}
	var FULLSCREEN_ATTRIBUTE = "data-hokensync-fullscreen";
	function insertFullscreenButton(openUi) {
		const queue = document.querySelector("[data-test-id=\"FULLSCREEN_PLAYER_QUEUE_BUTTON\"]");
		const existing = document.querySelector(`[${FULLSCREEN_ATTRIBUTE}]`);
		if (!queue || !queue.parentElement) return;
		const place = (target) => {
			const first = queue.getBoundingClientRect();
			if (!first.width) return;
			let rowRight = first.right;
			document.querySelectorAll("button[class*=\"FullscreenPlayerDesktopControls_\"]").forEach((item) => {
				if (item === target) return;
				const rect = item.getBoundingClientRect();
				if (rect.width && Math.abs(rect.top - first.top) < 12) rowRight = Math.max(rowRight, rect.right);
			});
			let block = null;
			for (let el = target.parentElement; el && el !== document.documentElement; el = el.parentElement) {
				const style = getComputedStyle(el);
				if (style.transform !== "none" || style.perspective !== "none" || style.filter !== "none" || style.backdropFilter && style.backdropFilter !== "none" || /transform|filter|perspective/.test(style.willChange) || /paint|layout|strict|content/.test(style.contain)) {
					block = el;
					break;
				}
			}
			const box = block ? block.getBoundingClientRect() : null;
			const scale = box && block && block.offsetWidth ? box.width / block.offsetWidth : 1;
			const originLeft = box && block ? box.left + block.clientLeft * scale : 0;
			const originTop = box && block ? box.top + block.clientTop * scale : 0;
			const blockRight = block ? originLeft + block.clientWidth * scale : window.innerWidth;
			const blockWidth = block ? block.clientWidth : window.innerWidth;
			const top = (first.top - originTop) / scale;
			const left = (blockRight - rowRight) / scale;
			if (top >= 0 && top <= 160 && left >= 0 && left <= blockWidth / 2) {
				target.style.setProperty("--fs-top", `${Math.round(top)}px`);
				target.style.setProperty("--fs-left", `${Math.round(left)}px`);
			} else {
				target.style.removeProperty("--fs-top");
				target.style.removeProperty("--fs-left");
			}
			target.dataset.placedFor = String(window.innerWidth);
		};
		const settle = (target) => {
			let last = "";
			let stable = 0;
			let frames = 0;
			const step = () => {
				if (!target.isConnected || !queue.isConnected || frames > 120) return;
				frames += 1;
				const rect = queue.getBoundingClientRect();
				const key = `${Math.round(rect.top)}|${Math.round(rect.right)}`;
				stable = key === last ? stable + 1 : 0;
				last = key;
				place(target);
				if (stable < 5) window.requestAnimationFrame(step);
			};
			window.requestAnimationFrame(step);
		};
		if (existing && queue.parentElement.contains(existing)) {
			if (existing.dataset.placedFor !== String(window.innerWidth)) settle(existing);
			return;
		}
		existing?.remove();
		const button = cloneQueueButton(queue, FULLSCREEN_ATTRIBUTE, "HOKENSYNC_FULLSCREEN_BUTTON", "Открыть HokenSync");
		const svg = button.querySelector("svg");
		button.classList.add("hokensync-fs-open");
		if (svg) {
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("style", "fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round");
			svg.innerHTML = ICON_SHAPES.split("hokensync-hs-").join("hokensync-fs-");
		}
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			openUi();
		});
		queue.parentElement.appendChild(button);
		settle(button);
	}
	function installPlayerButton(openUi) {
		let scheduled = false;
		const ensure = () => {
			scheduled = false;
			try {
				insertButton(openUi);
			} catch (error) {
				console.warn("[HokenSync] Не удалось добавить кнопку в панель плеера:", error);
			}
			try {
				insertFullscreenButton(openUi);
			} catch (error) {
				console.warn("[HokenSync] Не удалось добавить кнопку в полноэкранный плеер:", error);
			}
		};
		const schedule = () => {
			if (scheduled) return;
			scheduled = true;
			window.requestAnimationFrame(ensure);
		};
		const start = () => {
			new MutationObserver(schedule).observe(document.body, {
				childList: true,
				subtree: true
			});
			schedule();
		};
		if (document.body) start();
		else document.addEventListener("DOMContentLoaded", start, { once: true });
	}
	//#endregion
	//#region src/debug.ts
	function installDebugHelpers() {
		window.hokenTestSearch = async () => {
			const track = getCurrentTrack();
			if (!track) {
				console.log("[HokenSync TEST] Текущий трек не найден");
				return;
			}
			const startedAt = performance.now();
			console.log("[HokenSync TEST] Ищу:", track.artist, "-", track.title);
			let result;
			try {
				result = await searchLyrics({
					title: track.title,
					artist: track.artist,
					duration: typeof track.duration === "number" ? track.duration : void 0
				});
			} catch (error) {
				console.log("[HokenSync TEST] Поиск не удался:", error);
				return;
			}
			console.log("[HokenSync TEST] Время:", Math.round(performance.now() - startedAt) + " ms");
			console.log("[HokenSync TEST] Результат:", result);
		};
		window.hokenTestVariants = async () => {
			const track = getCurrentTrack();
			if (!track) {
				console.log("[HokenSync TEST] Текущий трек не найден");
				return;
			}
			try {
				const variants = await findLyricsVariants({
					title: track.title,
					artist: track.artist,
					duration: typeof track.duration === "number" ? track.duration : void 0
				}, true);
				console.log("[HokenSync TEST] Вариантов:", variants.length);
				console.table(variants.map((variant) => ({
					артист: variant.artistName,
					название: variant.trackName,
					длительность: variant.duration,
					таймкоды: Boolean(variant.synced),
					проигрыши: variant.breaks,
					оценка: variant.score,
					подставлять_сразу: variant.confident
				})));
			} catch (error) {
				console.log("[HokenSync TEST] Поиск не удался:", error);
			}
		};
		window.hokenTestTrack = () => {
			console.log("[HokenSync TEST] Текущий трек:", getCurrentTrack());
		};
		window.hokenTestCache = async () => {
			const track = getCurrentTrack();
			if (!track) {
				console.log("[HokenSync TEST CACHE] Трек не найден");
				return;
			}
			const cached = await getCachedLyrics(track.title, track.artist);
			console.log("[HokenSync TEST CACHE] Кэш:", cached);
		};
		window.hokenTestCacheApply = async () => {
			const track = getCurrentTrack();
			if (!track?.id) {
				console.log("[HokenSync TEST CACHE APPLY] Трек не найден");
				return;
			}
			const syncLyrics = findSyncLyricsModel();
			console.log("[HokenSync TEST CACHE APPLY] syncLyrics:", syncLyrics);
			if (!syncLyrics) {
				console.log("[HokenSync TEST CACHE APPLY] syncLyrics не найден");
				return;
			}
			console.log("[HokenSync TEST CACHE APPLY] Состояние:", {
				trackId: String(track.id),
				currentTrackId: syncLyrics.currentTrackId,
				loadingState: syncLyrics.loadingState,
				externalLyricId: syncLyrics.externalLyricId,
				hasNativeSyncLyrics: track.hasNativeSyncLyrics
			});
			const cached = await getCachedLyrics(track.title, track.artist);
			console.log("[HokenSync TEST CACHE APPLY] Кэш:", cached);
			if (!cached) {
				console.log("[HokenSync TEST CACHE APPLY] Кэш не найден");
				return;
			}
			const applied = applyCachedLyricsToSyncModel(syncLyrics, cached, String(track.id));
			console.log("[HokenSync TEST CACHE APPLY] Результат применения:", applied);
		};
	}
	//#endregion
	//#region src/yandex/health-check.ts
	function runHealthCheck() {
		const api = window.pulsesyncApi;
		const model = findSyncLyricsModel();
		return [
			{
				name: "PulseSync API",
				ok: Boolean(api && [
					"getCurrentTrack",
					"getProgress",
					"setProgress",
					"play",
					"pause"
				].every((key) => typeof api[key] === "function")),
				critical: true,
				hint: "Не найдены методы window.pulsesyncApi (трек, позиция, пауза)."
			},
			{
				name: "Хранилище приложения (react-store)",
				ok: Boolean(findRootStore()),
				critical: true,
				hint: "Не найден корневой стор Яндекс Музыки. Подмена текста в плеере работать не будет."
			},
			{
				name: "Модель текста (syncLyrics)",
				ok: Boolean(model && typeof model.getData === "function" && typeof model.toJSON === "function" && model.$treenode?._applySnapshot),
				critical: true,
				hint: "У модели текста изменились методы. Нужно обновить lyrics-model.ts."
			},
			{
				name: "Кнопка очереди в панели плеера",
				ok: Boolean(document.querySelector("[data-test-id=\"PLAYERBAR_DESKTOP_PLAY_QUEUE_BUTTON\"]")),
				critical: false,
				hint: "Не найдена кнопка очереди: рядом с ней ставится кнопка HokenSync в панели плеера."
			}
		];
	}
	var reported = false;
	function report(results) {
		const failed = results.filter((item) => !item.ok);
		if (!failed.length) {
			console.log("[HokenSync] Проверка совместимости: всё на месте.");
			return true;
		}
		console.warn("[HokenSync] Проверка совместимости, не найдено:", failed.map((item) => `${item.name}: ${item.hint}`));
		const critical = failed.filter((item) => item.critical);
		if (critical.length && !reported) {
			reported = true;
			showToast("HokenSync: часть функций недоступна", "warning", `${critical[0].name}. Подробности в консоли (hokenHealth()).`);
		}
		return false;
	}
	function scheduleHealthCheck() {
		window.hokenHealth = () => {
			const results = runHealthCheck();
			report(results);
			console.table(results.map(({ name, ok }) => ({
				name,
				ok
			})));
			return results;
		};
		window.setTimeout(() => {
			if (report(runHealthCheck())) return;
			window.setTimeout(() => report(runHealthCheck()), 25e3);
		}, 8e3);
	}
	//#endregion
	//#region src/main.ts
	console.log("[HokenSync] === HokenSync запущен ===");
	initLyricsCache().then(() => {
		console.log("[HokenSync] Локальный кэш текстов инициализирован");
	}).catch((error) => {
		console.error("[HokenSync] Не удалось открыть локальный кэш текстов:", error);
	});
	installLrclibInterceptor();
	installDebugHelpers();
	window.addEventListener("keydown", (event) => {
		if (event.ctrlKey && event.altKey && event.code === "KeyL") {
			event.preventDefault();
			openUi();
			return;
		}
		handleKeyDown(event);
	}, true);
	window.addEventListener("keyup", handleKeyUp, true);
	window.addEventListener("blur", stopSeek);
	installPlayerButton(openUi);
	scheduleHealthCheck();
	startSearchLimitBanner();
	restoreRepeatAfterUnexpectedClose();
	console.log("[HokenSync] Ctrl + Alt + L — открыть HokenSync");
	//#endregion
})();
