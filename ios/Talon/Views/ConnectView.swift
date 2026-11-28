import SwiftUI

/// The first screen: the address of the NAS and a Talon user name and password.
struct ConnectView: View {
    @EnvironmentObject private var session: Session
    @AppStorage("last.server") private var server = ""
    @AppStorage("last.user") private var user = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var trust: (account: Account, fingerprint: String)?
    @State private var access = CloudflareAccess()
    @State private var cloudflare: URL?

    private var ready: Bool { Account.normalize(server) != nil && !user.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty }

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    Image("Logo").resizable().frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    Text("Talon").font(.title2.bold())
                    Text("Your files and photo backup, on your own NAS").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            Section {
                TextField("https://192.168.1.50", text: $server)
                    .keyboardType(.URL).textContentType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            } header: {
                Text("NAS address")
            } footer: {
                Text("The address you open Talon with in a browser. Behind Cloudflare Access, the app shows Cloudflare's sign-in when it is needed.")
            }
            Section {
                TextField("User name", text: $user)
                    .textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Password", text: $password).textContentType(.password)
            } header: {
                Text("Talon user")
            } footer: {
                Text("A user from Users & Groups in Talon. You see the shared folders that user may open. WebDAV must be on under Services.")
            }
            if let error {
                Section { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
            }
            Section {
                Button {
                    Task { await connect(pin: nil) }
                } label: {
                    HStack {
                        Spacer()
                        if busy { ProgressView() } else { Text("Connect").bold() }
                        Spacer()
                    }
                }
                .disabled(!ready || busy)
            }
        }
        .navigationTitle("Connect")
        .sheet(item: $cloudflare) { url in
            CloudflareSignIn(server: url) { cookie, expires in
                access.cookie = cookie
                access.cookieExpires = expires
                Task { await connect(pin: nil) }
            }
        }
        .alert("Trust this NAS?", isPresented: Binding(get: { trust != nil }, set: { if !$0 { trust = nil } })) {
            Button("Trust") {
                if let t = trust { Task { await connect(pin: t.fingerprint) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("\(trust?.account.host ?? "") uses Talon's own certificate. Check that its fingerprint matches the one under Settings → Network in Talon:\n\n\(trust?.fingerprint ?? "")")
        }
    }

    private func connect(pin: String?) async {
        guard let url = Account.normalize(server) else { return }
        busy = true
        error = nil
        defer { busy = false }
        let account = Account(server: url, user: user.trimmingCharacters(in: .whitespaces).lowercased(), pin: pin)
        let client = DavClient(account: account, password: password, access: access)
        do {
            _ = try await client.list([])
            server = url.absoluteString
            session.signIn(account, password: password, access: access)
        } catch DavError.untrusted(let fp) {
            trust = (account, fp)
        } catch DavError.cloudflare(denied: false) where !access.hasToken {
            cloudflare = url                                  // Cloudflare's sign-in, then connect again
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension URL: Identifiable {
    public var id: String { absoluteString }
}
