import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var backup: PhotoBackup
    @State private var confirm = false
    @State private var signIn = false
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
                Section {
                    LabeledContent("Status", value: cloudflareStatus)
                    Button { signIn = true } label: { Label(session.access.cookie.isEmpty ? "Sign in with Cloudflare" : "Sign in with Cloudflare again", systemImage: "person.badge.key") }
                    Button { token = session.access; editToken = true } label: { Label(session.access.hasToken ? "Change service token" : "Add service token", systemImage: "key") }
                    if !session.access.isEmpty {
                        Button("Stop using Cloudflare Access", role: .destructive) { session.setAccess(CloudflareAccess()) }
                    }
                } header: {
                    Text("Cloudflare Access")
                } footer: {
                    Text("The app signs in to Cloudflare by itself when it is needed; the sign-in lasts as long as the Access application allows. A service token never expires, so long photo backups are not interrupted.")
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
        .sheet(isPresented: $signIn) {
            if let url = session.account?.server {
                CloudflareSignIn(server: url) { cookie, expires in
                    var a = session.access
                    a.cookie = cookie
                    a.cookieExpires = expires
                    session.setAccess(a)
                }
            }
        }
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
