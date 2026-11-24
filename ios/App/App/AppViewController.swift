import Capacitor
import UIKit

/// The web app in a full-screen web view, on the same yellow as its start screen (the cover), with
/// the native GPS plugin registered.
class AppViewController: CAPBridgeViewController {
    static let cover = UIColor(red: 0xff / 255, green: 0xd2 / 255, blue: 0x3f / 255, alpha: 1)

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WalkTrackerPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .light
        view.backgroundColor = Self.cover
        guard let webView = webView else { return }
        webView.backgroundColor = Self.cover
        webView.scrollView.backgroundColor = Self.cover
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // A long press on the map is a map gesture, never a link preview.
        webView.allowsLinkPreview = false
    }
}
