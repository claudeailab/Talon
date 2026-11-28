import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var backup: PhotoBackup
    @State private var confirm = false
    @State private var editToken = false
    @State private var token = CloudflareAccess()

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
                // only for a NAS behind Cloudflare Access: the app signs in there by itself
                if !session.access.isEmpty {
                    Section {
                        LabeledContent("Status", value: cloudflareStatus)
                        Button { token = session.access; editToken = true } label: {
                            Text(session.access.hasToken ? "Change service token" : "Use a service token instead").font(.subheadline)
                        }
                    } header: {
                        Text("Cloudflare Access")
                    } footer: {
                        Text("The app signs in to Cloudflare by itself whenever it is needed. A service token is optional: it never expires, so long photo backups away from home are not interrupted by a new sign-in.")
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
        .sheet(isPresented: $editToken) {
            NavigationStack {
                Form { CloudflareTokenForm(access: $token) }
                    .navigationTitle("Service token")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { editToken = false } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Save") {
                                var a = session.access
                                a.clientId = token.clientId.trimmingCharacters(in: .whitespacesAndNewlines)
                                a.clientSecret = token.clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
                                session.setAccess(a)
                                editToken = false
                            }
                            .disabled(token.clientId.isEmpty != token.clientSecret.isEmpty)
                        }
                    }
            }
        }
        .confirmationDialog("Sign out of this NAS?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                backup.stop()
                session.signOut()
            }
        } message: {
            Text("Your files on the NAS stay. Photo backup remembers what was uploaded.")
        }
    }

    private var cloudflareStatus: String {
        let a = session.access
        if a.hasToken { return "Service token" }
        if a.hasCookie {
            if let e = a.cookieExpires { return "Signed in until \(e.formatted(date: .abbreviated, time: .shortened))" }
            return "Signed in"
        }
        if !a.cookie.isEmpty { return "Sign-in expired" }
        return "Not used"
    }
}
