import Photos
import SwiftUI

/// Back up the camera roll to a folder on the NAS.
struct PhotoBackupView: View {
    @EnvironmentObject private var backup: PhotoBackup
    @EnvironmentObject private var session: Session
    @Environment(\.dav) private var dav
    @State private var choosing = false
    @State private var allowed = PHPhotoLibrary.authorizationStatus(for: .readWrite).allowsReading

    var body: some View {
        Form {
            Section {
                status
            }
            Section {
                Button { choosing = true } label: {
                    HStack {
                        Label("Folder", systemImage: "folder")
                        Spacer()
                        Text(backup.folder.isEmpty ? "Choose" : backup.folder.joined(separator: " / "))
                            .foregroundStyle(backup.folder.isEmpty ? Color.accentColor : .secondary).lineLimit(1)
                    }
                }
                .disabled(backup.running)
                Toggle(isOn: $backup.videos) { Label("Videos too", systemImage: "film") }
                    .disabled(backup.running)
                Toggle(isOn: $backup.automatic) { Label("Back up when the app opens", systemImage: "arrow.clockwise") }
            } header: {
                Text("Settings")
            } footer: {
                Text("Photos go into a folder per year and month, e.g. \((backup.folder.isEmpty ? ["Photos"] : backup.folder).joined(separator: "/"))/2026/2026-11, as the original files with their dates. Each photo is uploaded once.")
            }
            Section {
                if backup.running {
                    Button(role: .destructive) { backup.stop() } label: { centered("Stop") }
                } else {
                    Button {
                        Task {
                            allowed = await PhotoBackup.authorize()
                            if let dav, allowed { backup.start(dav) }
                        }
                    } label: { centered("Back up now") }
                    .disabled(backup.folder.isEmpty)
                }
            } footer: {
                Text("Keep Talon open until it finishes: iPhone pauses apps soon after you leave them. The screen stays on meanwhile.")
            }
        }
        .navigationTitle("Photo backup")
        .sheet(isPresented: $choosing) {
            NavigationStack {
                FolderPicker(path: [], title: "Choose a folder") { picked in
                    backup.folder = picked
                    choosing = false
                }
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { choosing = false } } }
            }
            .environment(\.dav, dav)
        }
        .task {
            allowed = PHPhotoLibrary.authorizationStatus(for: .readWrite).allowsReading
            await backup.refreshCounts(session.account)
        }
    }

    @ViewBuilder
    private var status: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.title2).foregroundStyle(tint).frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(headline).font(.headline)
                    Text(subline).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            if backup.state == .running {
                ProgressView(value: Double(backup.done), total: Double(max(backup.total, 1)))
                if !backup.current.isEmpty { Text(backup.current).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
            } else if backup.state == .preparing {
                ProgressView()
            }
        }
        .padding(.vertical, 4)
    }

    private var icon: String {
        switch backup.state {
        case .failed: return "exclamationmark.triangle.fill"
        case .running, .preparing: return "arrow.up.circle.fill"
        default: return backup.inLibrary > 0 && backup.backedUp >= backup.inLibrary ? "checkmark.circle.fill" : "photo.on.rectangle.angled"
        }
    }

    private var tint: Color {
        switch backup.state {
        case .failed: return .orange
        case .running, .preparing: return .accentColor
        default: return backup.inLibrary > 0 && backup.backedUp >= backup.inLibrary ? .green : .secondary
        }
    }

    private var headline: String {
        switch backup.state {
        case .preparing: return "Looking for new photos…"
        case .running: return "Uploading \(min(backup.done + 1, backup.total)) of \(backup.total)"
        case .failed: return "The backup stopped"
        default:
            if !allowed { return "Allow access to your photos" }
            if backup.folder.isEmpty { return "Choose a folder on the NAS" }
            return backup.backedUp >= backup.inLibrary ? "All photos are backed up" : "\(backup.inLibrary - backup.backedUp) not backed up yet"
        }
    }

    private var subline: String {
        if case let .failed(text) = backup.state { return text }
        var s = "\(backup.backedUp) of \(backup.inLibrary) backed up"
        if let last = backup.lastRun { s += " · last \(last.formatted(date: .abbreviated, time: .shortened))" }
        return allowed ? s : "Tap Back up now, then allow access."
    }

    private func centered(_ text: String) -> some View {
        HStack { Spacer(); Text(text).bold(); Spacer() }
    }
}

/// Folders only, with "Use this folder"; the top level lists the shared folders.
struct FolderPicker: View {
    let path: [String]
    let title: String
    let onPick: ([String]) -> Void
    @Environment(\.dav) private var dav
    @State private var folders: [DavItem]?
    @State private var error: String?
    @State private var newFolder = false
    @State private var name = ""

    var body: some View {
        List {
            if let folders {
                ForEach(folders) { f in
                    NavigationLink {
                        FolderPicker(path: f.path, title: f.name, onPick: onPick)
                    } label: {
                        Label(f.name, systemImage: path.isEmpty ? FolderView.topIcon(f.name) : "folder.fill")
                    }
                }
                if folders.isEmpty { Text(path.isEmpty ? "No shared folders you may open." : "No folders here.").foregroundStyle(.secondary) }
                if path.isEmpty {
                    Text("Administrators also see each volume, to back up to any folder on it.").font(.footnote).foregroundStyle(.secondary)
                }
            } else if let error {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !path.isEmpty {
                ToolbarItem(placement: .bottomBar) {
                    Button { onPick(path) } label: { Text("Use \(path.last ?? "this folder")").bold() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { name = ""; newFolder = true } label: { Image(systemName: "folder.badge.plus") }
                }
            }
        }
        .alert("New folder", isPresented: $newFolder) {
            TextField("Name", text: $name)
            Button("Create") {
                Task {
                    let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let dav, !n.isEmpty, !n.contains("/") else { return }
                    do { try await dav.makeFolder(path + [n]); await load() } catch { self.error = error.localizedDescription }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .task { await load() }
    }

    private func load() async {
        guard let dav else { return }
        do { folders = try await dav.list(path).filter(\.isDir) } catch { self.error = error.localizedDescription }
    }
}
