import Foundation
import Photos
import UIKit

/// Backs up the camera roll to a folder on the NAS: <folder>/<year>/<year-month>/<original file name>,
/// the original files (HEIC, JPEG, MOV…) with their original dates. Photos already on
/// the NAS are remembered, so each one is uploaded once.
@MainActor
final class PhotoBackup: ObservableObject {
    static let shared = PhotoBackup()

    enum State: Equatable { case idle, preparing, running, done, failed(String) }

    @Published var state: State = .idle
    @Published var done = 0
    @Published var total = 0
    @Published var current = ""
    @Published private(set) var backedUp = 0
    @Published private(set) var inLibrary = 0

    /// the folder on the NAS, e.g. ["Photos", "iPhone"]
    @Published var folder: [String] = UserDefaults.standard.stringArray(forKey: "backup.folder") ?? [] {
        didSet { UserDefaults.standard.set(folder, forKey: "backup.folder"); Task { await refreshCounts() } }
    }
    @Published var videos: Bool = UserDefaults.standard.object(forKey: "backup.videos") as? Bool ?? true {
        didSet { UserDefaults.standard.set(videos, forKey: "backup.videos"); Task { await refreshCounts() } }
    }
    @Published var automatic: Bool = UserDefaults.standard.bool(forKey: "backup.auto") {
        didSet { UserDefaults.standard.set(automatic, forKey: "backup.auto") }
    }
    @Published private(set) var lastRun: Date? = UserDefaults.standard.object(forKey: "backup.last") as? Date

    private var task: Task<Void, Never>?
    private var uploaded: Set<String> = []
    private var storeKey = ""
    private var account: Account?

    var running: Bool { state == .preparing || state == .running }

    // MARK: what was uploaded, per NAS and folder

    private func storeURL(_ key: String) -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = key.map { $0.isLetter || $0.isNumber ? $0 : "_" }
        return dir.appendingPathComponent("backup-\(String(safe)).json")
    }

    private func load(_ account: Account) {
        let key = "\(account.server.absoluteString)|\(account.user)|\(folder.joined(separator: "/"))"
        guard key != storeKey else { return }
        storeKey = key
        if let data = try? Data(contentsOf: storeURL(key)), let ids = try? JSONDecoder().decode([String].self, from: data) {
            uploaded = Set(ids)
        } else {
            uploaded = []
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(Array(uploaded)) { try? data.write(to: storeURL(storeKey), options: .atomic) }
    }

    // MARK: counts

    private func assets() -> [PHAsset] {
        let opts = PHFetchOptions()
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        if !videos { opts.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue) }
        else { opts.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue) }
        let r = PHAsset.fetchAssets(with: opts)
        var out: [PHAsset] = []
        out.reserveCapacity(r.count)
        r.enumerateObjects { a, _, _ in out.append(a) }
        return out
    }

    func refreshCounts(_ account: Account? = nil) async {
        guard PHPhotoLibrary.authorizationStatus(for: .readWrite).allowsReading else { return }
        if let a = account ?? self.account {
            self.account = a
            load(a)
        }
        let all = assets()
        inLibrary = all.count
        backedUp = all.filter { uploaded.contains($0.localIdentifier) }.count
    }

    static func authorize() async -> Bool {
        let s = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if s.allowsReading { return true }
        if s != .notDetermined { return false }
        return await PHPhotoLibrary.requestAuthorization(for: .readWrite).allowsReading
    }

    // MARK: running

    func start(_ client: DavClient) {
        guard !running, !folder.isEmpty else { return }
        task = Task { await run(client) }
    }

    func stop() {
        task?.cancel()
    }

    private func run(_ client: DavClient) async {
        state = .preparing
        done = 0
        current = ""
        guard await Self.authorize() else {
            state = .failed("Talon may not read your photos. Allow it under Settings → Privacy & Security → Photos.")
            return
        }
        account = client.account
        load(client.account)
        let todo = assets().filter { !uploaded.contains($0.localIdentifier) }
        total = todo.count
        state = .running
        // keep going for a while when the app goes to the background, and keep the screen on
        UIApplication.shared.isIdleTimerDisabled = true
        var bg = UIApplication.shared.beginBackgroundTask(withName: "Photo backup") {}
        defer {
            UIApplication.shared.isIdleTimerDisabled = false
            UIApplication.shared.endBackgroundTask(bg)
            bg = .invalid
        }
        var made = Set<String>()
        let months = DateFormatter()
        months.locale = Locale(identifier: "en_US_POSIX")
        months.dateFormat = "yyyy-MM"
        do {
            for asset in todo {
                try Task.checkCancellation()
                guard let resource = Self.original(asset) else { done += 1; continue }
                let date = asset.creationDate ?? Date()
                let year = String(Calendar.current.component(.year, from: date))
                let dir = folder + [year, months.string(from: date)]
                for i in folder.count..<dir.count {
                    let p = Array(dir[0...i])
                    let key = p.joined(separator: "/")
                    if !made.contains(key) { try await client.makeFolder(p); made.insert(key) }
                }
                current = resource.originalFilename
                let file = try await Self.export(resource)
                defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
                let size = ((try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? NSNumber)?.int64Value
                let name = resource.originalFilename
                let there = try await client.size(of: dir + [name])
                if there == nil {
                    try await client.upload(file, to: dir + [name], modified: date)
                } else if there != size {
                    // a different photo with the same name is there already (another phone, a reset counter)
                    let ext = (name as NSString).pathExtension
                    let base = (name as NSString).deletingPathExtension
                    let tag = String(asset.localIdentifier.prefix(8))
                    let other = ext.isEmpty ? "\(base)-\(tag)" : "\(base)-\(tag).\(ext)"
                    if try await client.size(of: dir + [other]) != size {
                        try await client.upload(file, to: dir + [other], modified: date)
                    }
                }
                uploaded.insert(asset.localIdentifier)
                done += 1
                backedUp += 1
                if done % 10 == 0 { save() }
            }
            save()
            lastRun = Date()
            UserDefaults.standard.set(lastRun, forKey: "backup.last")
            state = .done
        } catch is CancellationError {
            save()
            state = .idle
        } catch {
            save()
            state = (error as? URLError)?.code == .cancelled ? .idle : .failed(error.localizedDescription)
        }
        current = ""
    }

    /// The original photo or video (not an edited version, not the video half of a Live Photo).
    private static func original(_ asset: PHAsset) -> PHAssetResource? {
        let r = PHAssetResource.assetResources(for: asset)
        let want: [PHAssetResourceType] = asset.mediaType == .video ? [.video, .fullSizeVideo] : [.photo, .fullSizePhoto]
        for t in want { if let x = r.first(where: { $0.type == t }) { return x } }
        return r.first
    }

    /// Copies the file out of the photo library (downloading it from iCloud when needed).
    private static func export(_ resource: PHAssetResource) async throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(resource.originalFilename)
        let opts = PHAssetResourceRequestOptions()
        opts.isNetworkAccessAllowed = true
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            PHAssetResourceManager.default().writeData(for: resource, toFile: url, options: opts) { error in
                if let error { c.resume(throwing: error) } else { c.resume() }
            }
        }
        return url
    }
}

extension PHAuthorizationStatus {
    var allowsReading: Bool { self == .authorized || self == .limited }
}
