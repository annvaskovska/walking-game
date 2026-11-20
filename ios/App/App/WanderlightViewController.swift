import Capacitor
import UIKit

/// The web app in a full-screen web view, on the same night colour as its start screen, with the
/// native GPS plugin registered.
class WanderlightViewController: CAPBridgeViewController {
    static let night = UIColor(red: 0x0b / 255, green: 0x0d / 255, blue: 0x12 / 255, alpha: 1)

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WalkTrackerPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .dark
        view.backgroundColor = Self.night
        guard let webView = webView else { return }
        webView.backgroundColor = Self.night
        webView.scrollView.backgroundColor = Self.night
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // A long press on the map is a map gesture, never a link preview.
        webView.allowsLinkPreview = false
    }
}
