import PhotosUI
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

/// A folder on the NAS: its folders and files. The top level lists the shared folders.
struct FolderView: View {
    let path: [String]
    let title: String
    @Environment(\.dav) private var dav
    @State private var items: [DavItem]?
    @State private var error: String?
    @State private var preview: URL?
    @State private var opening: String?
    @State private var newFolder = false
    @State private var folderName = ""
    @State private var importing = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var pickingPhotos = false
    @State private var uploading: (done: Int, total: Int)?
    @State private var deleting: DavItem?
    @State private var errorAlert: String?

    private var inShare: Bool { !path.isEmpty }

    var body: some View {
        Group {
            if let items {
                if items.isEmpty {
                    empty
                } else {
                    List {
                        ForEach(items) { item in row(item) }
                            .onDelete(perform: deleteAction(items))
                    }
                    .listStyle(.plain)
                }
            } else if let error {
                failure(error)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(path.isEmpty ? .large : .inline)
        .refreshable { await load() }
        .task { if items == nil { await load() } }
        .toolbar {
            if inShare {
                Menu {
                    Button { pickingPhotos = true } label: { Label("Upload photos", systemImage: "photo") }
                    Button { importing = true } label: { Label("Upload files", systemImage: "doc") }
                    Button { folderName = ""; newFolder = true } label: { Label("New folder", systemImage: "folder.badge.plus") }
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(uploading != nil)
            }
        }
        .safeAreaInset(edge: .bottom) { progressBar }
        .overlay { if let opening { busy("Opening \(opening)…") } }
        .quickLookPreview($preview)
        .alert("Something went wrong", isPresented: Binding(get: { errorAlert != nil }, set: { if !$0 { errorAlert = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorAlert ?? "")
        }
        .alert("New folder", isPresented: $newFolder) {
            TextField("Name", text: $folderName)
            Button("Create") { Task { await makeFolder() } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete \(deleting?.name ?? "")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete", role: .destructive) { if let d = deleting { Task { await delete(d) } } }
        } message: {
            Text("It goes to the shared folder's recycle bin when that is on.")
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case let .success(urls) = result { Task { await upload(files: urls) } }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, matching: .any(of: [.images, .videos]))
        .onChange(of: photos) { picked in
            guard !picked.isEmpty else { return }
            Task { await upload(photos: picked); photos = [] }
        }
    }

    // MARK: rows

    /// swipe to delete, inside a shared folder (not on the list of shared folders)
    private func deleteAction(_ items: [DavItem]) -> ((IndexSet) -> Void)? {
        guard inShare else { return nil }
        return { idx in deleting = idx.first.map { items[$0] } }
    }

    @ViewBuilder
    private func row(_ item: DavItem) -> some View {
        if item.isDir {
            NavigationLink {
                FolderView(path: item.path, title: item.name)
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name).lineLimit(1)
                        if let m = item.modified, inShare { Text(m, style: .date).font(.caption).foregroundStyle(.secondary) }
                    }
                } icon: {
                    Image(systemName: path.isEmpty ? "externaldrive.connected.to.line.below" : "folder.fill").foregroundStyle(.tint)
                }
            }
        } else {
            Button { Task { await open(item) } } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name).lineLimit(1).foregroundStyle(.primary)
                        Text(detail(item)).font(.caption).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: Self.icon(item.name)).foregroundStyle(.secondary)
                }
            }
            .contextMenu {
                Button { Task { await open(item) } } label: { Label("Open", systemImage: "eye") }
                Button(role: .destructive) { deleting = item } label: { Label("Delete", systemImage: "trash") }
            }
        }
    }

    private func detail(_ item: DavItem) -> String {
        var parts: [String] = []
        if let s = item.size { parts.append(ByteCountFormatter.string(fromByteCount: s, countStyle: .file)) }
        if let m = item.modified { parts.append(m.formatted(date: .abbreviated, time: .shortened)) }
        return parts.joined(separator: " · ")
    }

    static func icon(_ name: String) -> String {
        let t = UTType(filenameExtension: (name as NSString).pathExtension.lowercased())
        if t?.conforms(to: .image) == true { return "photo" }
        if t?.conforms(to: .movie) == true || t?.conforms(to: .video) == true { return "film" }
        if t?.conforms(to: .audio) == true { return "music.note" }
        if t?.conforms(to: .pdf) == true { return "doc.richtext" }
        if t?.conforms(to: .archive) == true { return "doc.zipper" }
        if t?.conforms(to: .text) == true { return "doc.text" }
        return "doc"
    }

    private var empty: some View {
        VStack(spacing: 10) {
            Image(systemName: path.isEmpty ? "externaldrive" : "folder").font(.system(size: 40)).foregroundStyle(.secondary)
            Text(path.isEmpty ? "No shared folders" : "This folder is empty").font(.headline)
            Text(path.isEmpty ? "This user may not open any shared folder yet. An administrator can give access under Shared Folders in Talon." : "Upload files or photos with +.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func failure(_ text: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle").font(.system(size: 36)).foregroundStyle(.orange)
            Text(text).multilineTextAlignment(.center)
            Button("Try again") { Task { await load() } }.buttonStyle(.borderedProminent)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func busy(_ text: String) -> some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(text).font(.subheadline).lineLimit(2).multilineTextAlignment(.center)
        }
        .padding(24)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder
    private var progressBar: some View {
        if let u = uploading {
            VStack(alignment: .leading, spacing: 6) {
                Text("Uploading \(min(u.done + 1, u.total)) of \(u.total)").font(.footnote.weight(.medium))
                ProgressView(value: Double(u.done), total: Double(max(u.total, 1)))
            }
            .padding()
            .background(.regularMaterial)
        }
    }

    // MARK: actions

    private func load() async {
        guard let dav else { return }
        do {
            items = try await dav.list(path)
            error = nil
        } catch {
            if items == nil { self.error = error.localizedDescription }
        }
    }

    private func open(_ item: DavItem) async {
        guard let dav, opening == nil else { return }
        opening = item.name
        defer { opening = nil }
        do { preview = try await dav.download(item) } catch { show(error) }
    }

    private func makeFolder() async {
        let name = folderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let dav, !name.isEmpty, !name.contains("/") else { return }
        do { try await dav.makeFolder(path + [name]); await load() } catch { show(error) }
    }

    private func delete(_ item: DavItem) async {
        guard let dav else { return }
        do { try await dav.delete(item); await load() } catch { show(error) }
    }

    private func upload(files: [URL]) async {
        guard let dav else { return }
        uploading = (0, files.count)
        defer { uploading = nil }
        for (i, url) in files.enumerated() {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
                try await dav.upload(url, to: path + [url.lastPathComponent], modified: date)
            } catch { show(error); break }
            uploading = (i + 1, files.count)
        }
        await load()
    }

    private func upload(photos picked: [PhotosPickerItem]) async {
        guard let dav else { return }
        uploading = (0, picked.count)
        defer { uploading = nil }
        for (i, p) in picked.enumerated() {
            do {
                guard let data = try await p.loadTransferable(type: Data.self) else { continue }
                let ext = p.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
                let stamp = Date().formatted(.iso8601.year().month().day().time(includingFractionalSeconds: false)).replacingOccurrences(of: ":", with: "")
                let name = "Photo \(stamp)-\(i + 1).\(ext)"
                let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "." + ext)
                try data.write(to: tmp)
                defer { try? FileManager.default.removeItem(at: tmp) }
                try await dav.upload(tmp, to: path + [name])
            } catch { show(error); break }
            uploading = (i + 1, picked.count)
        }
        await load()
    }

    private func show(_ error: Error) {
        errorAlert = error.localizedDescription
    }
}
