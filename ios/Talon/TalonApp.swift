import SwiftUI

@main
struct TalonApp: App {
    @StateObject private var session = Session()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(PhotoBackup.shared)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var backup: PhotoBackup
    @Environment(\.scenePhase) private var phase

    var body: some View {
        if let client = session.client {
            TabView {
                NavigationStack { FolderView(path: [], title: "Files") }
                    .tabItem { Label("Files", systemImage: "folder") }
                NavigationStack { PhotoBackupView() }
                    .tabItem { Label("Photos", systemImage: "photo.on.rectangle.angled") }
                NavigationStack { SettingsView() }
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            }
            .environment(\.dav, client)
            .onChange(of: phase) { p in
                // "back up when the app opens"
                if p == .active, backup.automatic, !backup.folder.isEmpty { backup.start(client) }
            }
        } else {
            NavigationStack { ConnectView() }
        }
    }
}

private struct DavKey: EnvironmentKey {
    static let defaultValue: DavClient? = nil
}

extension EnvironmentValues {
    var dav: DavClient? {
        get { self[DavKey.self] }
        set { self[DavKey.self] = newValue }
    }
}
