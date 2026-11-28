import SwiftUI
import WebKit

/// "Sign in with Cloudflare": Cloudflare Access's own sign-in page (email code, Microsoft,
/// GitHub… whatever the Access policy offers). When it is done Cloudflare sets the
/// CF_Authorization cookie on the NAS's address; the app keeps it and sends it along.
struct CloudflareSignIn: View {
    let server: URL
    let onDone: (_ cookie: String, _ expires: Date?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var loading = true

    var body: some View {
        NavigationStack {
            CloudflareWebView(server: server, loading: $loading) { cookie, expires in
                onDone(cookie, expires)
                dismiss()
            }
            .ignoresSafeArea(edges: .bottom)
            .overlay(alignment: .top) { if loading { ProgressView().padding() } }
            .navigationTitle("Cloudflare sign-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

private struct CloudflareWebView: UIViewRepresentable {
    let server: URL
    @Binding var loading: Bool
    let onCookie: (String, Date?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()                 // a fresh sign-in each time
        let web = WKWebView(frame: .zero, configuration: cfg)
        // some identity providers refuse embedded browsers; present as Safari
        web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        cfg.websiteDataStore.httpCookieStore.add(context.coordinator)
        web.load(URLRequest(url: server))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKHTTPCookieStoreObserver {
        let parent: CloudflareWebView
        private var done = false

        init(_ parent: CloudflareWebView) { self.parent = parent }

        func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
            cookieStore.getAllCookies { cookies in
                let host = self.parent.server.host?.lowercased() ?? ""
                guard !self.done, let c = cookies.first(where: { $0.name == "CF_Authorization" && host.hasSuffix($0.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))) }) else { return }
                self.done = true
                DispatchQueue.main.async { self.parent.onCookie(c.value, c.expiresDate) }
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { parent.loading = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.loading = false
            cookiesDidChange(in: webView.configuration.websiteDataStore.httpCookieStore)
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { parent.loading = false }

        /// sign-in pages that open a new window: keep them in this one
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            webView.load(navigationAction.request)
            return nil
        }
    }
}

/// The service token of a Cloudflare Access policy (Service Auth): lets the app through
/// without signing in, also for long photo backups.
struct CloudflareTokenForm: View {
    @Binding var access: CloudflareAccess

    var body: some View {
        Section {
            TextField("Client ID", text: $access.clientId)
                .textInputAutocapitalization(.never).autocorrectionDisabled().font(.callout.monospaced())
            SecureField("Client secret", text: $access.clientSecret)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
        } header: {
            Text("Cloudflare Access service token")
        } footer: {
            Text("Only when the NAS is behind Cloudflare Access. In Cloudflare Zero Trust: Access → Service Auth → Create service token, then add a policy with action Service Auth that includes it, on the application of your NAS. Leave empty to sign in with Cloudflare instead.")
        }
    }
}
