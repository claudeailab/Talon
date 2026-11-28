import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var backup: PhotoBackup
    @State private var confirm = false

    var body: some View {
        Form {
            if let a = session.account {
                Section("Connected to") {
                    LabeledContent("NAS", value: a.server.absoluteString)
                    LabeledContent("User", value: a.user)
                    if let pin = a.pin {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Trusted certificate")
                            Text(pin).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                    }
                }
                Section {
                    Link(destination: a.server) { Label("Open Talon in Safari", systemImage: "safari") }
                }
            }
            Section {
                Button("Sign out", role: .destructive) { confirm = true }
            } footer: {
                Text("Talon for iPhone \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
            }
        }
        .navigationTitle("Settings")
        .confirmationDialog("Sign out of this NAS?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                backup.stop()
                session.signOut()
            }
        } message: {
            Text("Your files on the NAS stay. Photo backup remembers what was uploaded.")
        }
    }
}
