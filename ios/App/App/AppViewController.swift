import Capacitor
import UIKit

/// The web app in a full-screen web view, on the same paper colour as its start screen, with the
/// native GPS plugin registered.
class AppViewController: CAPBridgeViewController {
    static let paper = UIColor(red: 0xf6 / 255, green: 0xf2 / 255, blue: 0xe9 / 255, alpha: 1)

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WalkTrackerPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .light
        view.backgroundColor = Self.paper
        guard let webView = webView else { return }
        webView.backgroundColor = Self.paper
        webView.scrollView.backgroundColor = Self.paper
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // A long press on the map is a map gesture, never a link preview.
        webView.allowsLinkPreview = false
    }
}
