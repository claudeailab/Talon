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
    private(set) var client: DavClient?

    init() {
        if let data = UserDefaults.standard.data(forKey: "account"),
           let a = try? JSONDecoder().decode(Account.self, from: data),
           let pw = Keychain.get("password") {
            account = a
            client = DavClient(account: a, password: pw)
        }
    }

    func signIn(_ a: Account, password: String) {
        if let data = try? JSONEncoder().encode(a) { UserDefaults.standard.set(data, forKey: "account") }
        Keychain.set(password, for: "password")
        client = DavClient(account: a, password: password)
        account = a
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: "account")
        Keychain.delete("password")
        client = nil
        account = nil
    }
}
