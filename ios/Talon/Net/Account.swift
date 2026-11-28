import Foundation
import Security

/// The NAS this app is connected to. The password is kept in the Keychain.
struct Account: Codable, Equatable {
    /// e.g. https://192.168.1.50 (no trailing slash)
    var server: URL
    var user: String
    /// SHA-256 fingerprint of the NAS's own certificate, trusted by the user ("AB:CD:…")
    var pin: String?

    var host: String { server.host ?? server.absoluteString }

    /// "192.168.1.50", "nas.local:8443", "https://nas.example.com/" → a clean https URL.
    static func normalize(_ text: String) -> URL? {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.isEmpty { return nil }
        if !t.lowercased().hasPrefix("http://") && !t.lowercased().hasPrefix("https://") { t = "https://" + t }
        while t.hasSuffix("/") { t.removeLast() }
        if t.lowercased().hasSuffix("/dav") { t.removeLast(4) }
        guard var c = URLComponents(string: t), c.host?.isEmpty == false else { return nil }
        c.query = nil
        c.fragment = nil
        return c.url
    }
}

/// Getting through Cloudflare Access, when the NAS is behind it: a service token
/// (Client ID and secret, sent with every request) and/or the sign-in cookie Cloudflare
/// gives after "Sign in with Cloudflare". Kept in the Keychain.
struct CloudflareAccess: Codable, Equatable {
    var clientId = ""
    var clientSecret = ""
    var cookie = ""
    var cookieExpires: Date?

    var hasToken: Bool { !clientId.isEmpty && !clientSecret.isEmpty }
    var hasCookie: Bool { !cookie.isEmpty && (cookieExpires.map { $0 > Date() } ?? true) }
    var isEmpty: Bool { !hasToken && cookie.isEmpty }

    static func load() -> CloudflareAccess {
        guard let s = Keychain.get("cloudflare"), let a = try? JSONDecoder().decode(CloudflareAccess.self, from: Data(s.utf8)) else { return CloudflareAccess() }
        return a
    }

    func save() {
        if isEmpty { Keychain.delete("cloudflare"); return }
        if let d = try? JSONEncoder().encode(self), let s = String(data: d, encoding: .utf8) { Keychain.set(s, for: "cloudflare") }
    }
}

enum Keychain {
    private static let service = "io.github.claudeailab.talon"

    static func set(_ value: String, for key: String) {
        delete(key)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: Data(value.utf8),
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(q as CFDictionary)
    }
}

/// The signed-in account, shared by all screens.
@MainActor
final class Session: ObservableObject {
    @Published private(set) var account: Account?
    @Published private(set) var client: DavClient?
    @Published private(set) var access = CloudflareAccess.load()
    /// Cloudflare Access asked for a sign-in (none yet, or it expired): shows "Sign in with Cloudflare"
    @Published var cloudflarePrompt = false

    init() {
        if let data = UserDefaults.standard.data(forKey: "account"),
           let a = try? JSONDecoder().decode(Account.self, from: data),
           let pw = Keychain.get("password") {
            account = a
            client = makeClient(a, pw)
        }
    }

    private func makeClient(_ a: Account, _ password: String) -> DavClient {
        let c = DavClient(account: a, password: password, access: access)
        c.onCloudflareSignIn = { [weak self] in
            Task { @MainActor in
                guard let self, !self.access.hasToken else { return }
                self.cloudflarePrompt = true
            }
        }
        return c
    }

    func signIn(_ a: Account, password: String, access: CloudflareAccess) {
        if let data = try? JSONEncoder().encode(a) { UserDefaults.standard.set(data, forKey: "account") }
        Keychain.set(password, for: "password")
        self.access = access
        access.save()
        client = makeClient(a, password)
        account = a
    }

    /// New Cloudflare Access settings (a sign-in, a service token): the connection uses them at once.
    func setAccess(_ access: CloudflareAccess) {
        self.access = access
        access.save()
        if let a = account, let pw = Keychain.get("password") { client = makeClient(a, pw) }
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: "account")
        Keychain.delete("password")
        access = CloudflareAccess()
        access.save()
        client = nil
        account = nil
    }
}
