import CryptoKit
import Foundation

/// A file or folder on the NAS. `path` is relative to /dav: [] is the list of shared
/// folders, ["Photos", "2026"] a folder inside the shared folder Photos.
struct DavItem: Identifiable, Hashable {
    let name: String
    let path: [String]
    let isDir: Bool
    let size: Int64?
    let modified: Date?
    var id: String { path.joined(separator: "/") }
}

enum DavError: LocalizedError {
    /// the NAS uses its own certificate; the user can trust it after checking the fingerprint
    case untrusted(fingerprint: String)
    /// the NAS is behind Cloudflare Access, which wants a sign-in or a service token
    case cloudflare(denied: Bool)
    case http(Int, String)
    case unreachable(String)

    var errorDescription: String? {
        switch self {
        case .untrusted: return "This NAS uses its own certificate."
        case .cloudflare(denied: true): return "Cloudflare Access refused the connection. Check the service token, or that your account is allowed in the Access policy."
        case .cloudflare: return "This NAS is behind Cloudflare Access. Sign in with Cloudflare, or add a service token under Settings."
        case let .http(code, text):
            switch code {
            case 401: return "Wrong user name or password."
            case 403: return text.isEmpty ? "You may not change this folder." : text
            case 404 where text.contains("WebDAV"): return text
            case 404: return "Not found. Is this the address of your Talon NAS?"
            case 409: return "The folder does not exist."
            case 413: return "This file is too large to send through Cloudflare (at most 100 MB per file on its free plan). Send it at home, over the NAS's own address."
            case 429: return text
            default: return text.isEmpty ? "The NAS answered with error \(code)." : text
            }
        case let .unreachable(text): return text
        }
    }
}

/// Talks WebDAV to Talon (https://<nas>/dav/). Signs in with the Talon user name and
/// password (Basic auth over HTTPS) and accepts the NAS's own certificate only when its
/// fingerprint matches the one the user trusted.
final class DavClient: NSObject, URLSessionTaskDelegate {
    let account: Account
    let access: CloudflareAccess
    /// called when Cloudflare Access wants a sign-in
    var onCloudflareSignIn: (() -> Void)?
    private let auth: String
    private var session: URLSession!
    private let lock = NSLock()
    private var untrusted: String?
    /// Settings → Date format on the NAS ("dd-mm-yyyy", "yyyy-mm-dd", …), from its answers
    private(set) var dateFormat = "dd-mm-yyyy"

    init(account: Account, password: String, access: CloudflareAccess = CloudflareAccess()) {
        self.account = account
        self.access = access
        auth = "Basic " + Data("\(account.user):\(password)".utf8).base64EncodedString()
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 6 * 3600
        cfg.waitsForConnectivity = false
        session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }

    // MARK: URLs and requests

    func url(_ path: [String], dir: Bool = false) -> URL {
        var u = account.server.appendingPathComponent("dav")
        for p in path { u.appendPathComponent(p) }
        if dir || path.isEmpty { u = URL(string: u.absoluteString + "/") ?? u }
        return u
    }

    private func request(_ method: String, _ path: [String], dir: Bool = false) -> URLRequest {
        var r = URLRequest(url: url(path, dir: dir))
        r.httpMethod = method
        r.setValue(auth, forHTTPHeaderField: "Authorization")
        if access.hasToken {
            r.setValue(access.clientId, forHTTPHeaderField: "CF-Access-Client-Id")
            r.setValue(access.clientSecret, forHTTPHeaderField: "CF-Access-Client-Secret")
        }
        if !access.cookie.isEmpty { r.setValue("CF_Authorization=\(access.cookie)", forHTTPHeaderField: "Cookie") }
        return r
    }

    private func send(_ r: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (d, rsp) = try await session.data(for: r)
            guard let h = rsp as? HTTPURLResponse else { throw DavError.unreachable("No answer from the NAS.") }
            if let f = h.value(forHTTPHeaderField: "X-Talon-Date-Format"), !f.isEmpty {
                lock.lock(); dateFormat = f; lock.unlock()
            }
            return (d, h)
        } catch {
            throw mapped(error)
        }
    }

    private func mapped(_ error: Error) -> Error {
        if error is DavError { return error }
        lock.lock(); let fp = untrusted; lock.unlock()
        if let fp, (error as? URLError)?.code == .cancelled || (error as? URLError)?.code == .serverCertificateUntrusted {
            return DavError.untrusted(fingerprint: fp)
        }
        if let u = error as? URLError {
            switch u.code {
            case .cannotFindHost, .cannotConnectToHost, .timedOut, .notConnectedToInternet, .networkConnectionLost:
                return DavError.unreachable("Talon can't be reached at \(account.host). Check the address and that you are on the right network.")
            default:
                return DavError.unreachable(u.localizedDescription)
            }
        }
        return error
    }

    private func ok(_ data: Data, _ r: HTTPURLResponse, _ allowed: Set<Int> = []) throws {
        // Cloudflare Access sends the browser to its sign-in page; it is not followed (see below)
        if (300..<400).contains(r.statusCode), Self.isAccessLogin(r.value(forHTTPHeaderField: "Location")) {
            onCloudflareSignIn?()
            throw DavError.cloudflare(denied: false)
        }
        // refused by Cloudflare itself (not by Talon: Talon's WebDAV answers carry a DAV header)
        if r.statusCode == 403, r.value(forHTTPHeaderField: "DAV") == nil, r.value(forHTTPHeaderField: "cf-ray") != nil {
            throw DavError.cloudflare(denied: true)
        }
        if (200..<300).contains(r.statusCode) || allowed.contains(r.statusCode) { return }
        let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        throw DavError.http(r.statusCode, text.count < 300 ? text : "")
    }

    // MARK: WebDAV

    /// The items in a folder (the shared folders when `path` is empty).
    func list(_ path: [String]) async throws -> [DavItem] {
        var r = request("PROPFIND", path, dir: true)
        r.setValue("1", forHTTPHeaderField: "Depth")
        r.setValue("application/xml; charset=utf-8", forHTTPHeaderField: "Content-Type")
        r.httpBody = Data("""
        <?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop>\
        <d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>
        """.utf8)
        let (data, resp) = try await send(r)
        try ok(data, resp)
        let items = PropfindParser.parse(data)
        return items
            .filter { $0.path != path }
            .sorted { ($0.isDir ? 0 : 1, $0.name.lowercased()) < ($1.isDir ? 0 : 1, $1.name.lowercased()) }
    }

    /// Downloads a file into a temporary folder and returns where it is.
    func download(_ item: DavItem) async throws -> URL {
        let r = request("GET", item.path)
        do {
            let (tmp, resp) = try await session.download(for: r)
            guard let h = resp as? HTTPURLResponse else { throw DavError.unreachable("No answer from the NAS.") }
            try ok(Data(), h)
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let dest = dir.appendingPathComponent(item.name)
            try FileManager.default.moveItem(at: tmp, to: dest)
            return dest
        } catch {
            throw mapped(error)
        }
    }

    /// Uploads a file; `modified` keeps the original date on the NAS.
    func upload(_ file: URL, to path: [String], modified: Date? = nil) async throws {
        var r = request("PUT", path)
        r.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        if let modified { r.setValue(String(Int(modified.timeIntervalSince1970)), forHTTPHeaderField: "X-OC-MTime") }
        do {
            let (data, resp) = try await session.upload(for: r, fromFile: file)
            guard let h = resp as? HTTPURLResponse else { throw DavError.unreachable("No answer from the NAS.") }
            try ok(data, h)
        } catch {
            throw mapped(error)
        }
    }

    /// Creates a folder; an existing one is fine.
    func makeFolder(_ path: [String]) async throws {
        let (data, resp) = try await send(request("MKCOL", path, dir: true))
        try ok(data, resp, [405])
    }

    func delete(_ item: DavItem) async throws {
        let (data, resp) = try await send(request("DELETE", item.path, dir: item.isDir))
        try ok(data, resp)
    }

    /// The size of a file on the NAS, or nil when there is none.
    func size(of path: [String]) async throws -> Int64? {
        let (data, resp) = try await send(request("HEAD", path))
        if resp.statusCode == 404 { return nil }
        try ok(data, resp)
        return resp.expectedContentLength >= 0 ? resp.expectedContentLength : 0
    }

    // MARK: Cloudflare Access

    static func isAccessLogin(_ location: String?) -> Bool {
        guard let l = location?.lowercased() else { return false }
        return l.contains("cloudflareaccess.com") || l.contains("/cdn-cgi/access/")
    }

    /// Redirects to Cloudflare Access's sign-in page are not followed: the app signs in
    /// with its own screen. Other redirects (e.g. http → https) are.
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        if Self.isAccessLogin(request.url?.absoluteString) { completionHandler(nil); return }
        // keep the sign-in headers on the new address of the same NAS
        var r = request
        if request.url?.host == account.server.host, let original = task.originalRequest {
            for h in ["Authorization", "CF-Access-Client-Id", "CF-Access-Client-Secret", "Cookie"] {
                if let v = original.value(forHTTPHeaderField: h) { r.setValue(v, forHTTPHeaderField: h) }
            }
        }
        completionHandler(r)
    }

    // MARK: certificate

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        // a certificate the phone trusts already (e.g. behind Cloudflare)
        if SecTrustEvaluateWithError(trust, nil) {
            completionHandler(.useCredential, URLCredential(trust: trust))
            return
        }
        let fp = Self.fingerprint(trust)
        if let fp, fp == account.pin {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            lock.lock(); untrusted = fp; lock.unlock()
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    static func fingerprint(_ trust: SecTrust) -> String? {
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else { return nil }
        let der = SecCertificateCopyData(leaf) as Data
        return SHA256.hash(data: der).map { String(format: "%02X", $0) }.joined(separator: ":")
    }
}

/// Reads a PROPFIND answer (multistatus) into items.
private final class PropfindParser: NSObject, XMLParserDelegate {
    private var items: [DavItem] = []
    private var text = ""
    private var href = ""
    private var length: Int64?
    private var modified: Date?
    private var isDir = false

    static let httpDate: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "GMT")
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return f
    }()

    static func parse(_ data: Data) -> [DavItem] {
        let p = PropfindParser()
        let x = XMLParser(data: data)
        x.shouldProcessNamespaces = true
        x.delegate = p
        x.parse()
        return p.items
    }

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
        text = ""
        switch name {
        case "response": href = ""; length = nil; modified = nil; isDir = false
        case "collection": isDir = true
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name {
        case "href": href = t
        case "getcontentlength": length = Int64(t)
        case "getlastmodified": modified = Self.httpDate.date(from: t)
        case "response":
            // "/dav/Photos/2026/IMG_1.HEIC" (or a full URL) → ["Photos", "2026", "IMG_1.HEIC"]
            var p = URL(string: href)?.path(percentEncoded: true) ?? href
            if let r = p.range(of: "/dav") { p = String(p[r.upperBound...]) }
            let parts = p.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
            items.append(DavItem(name: parts.last ?? "Talon", path: parts, isDir: isDir, size: isDir ? nil : length, modified: modified))
        default: break
        }
        text = ""
    }
}
