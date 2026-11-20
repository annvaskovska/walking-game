import Capacitor
import Foundation

/// The web app's way to the native GPS (src/platform/nativeLocation.ts). Every fix of a walk is
/// kept by `WalkTracker`; the web view gets each one as a `fix` event while it runs, and reads back
/// the ones it missed (screen locked, web view paused or reloaded) with `fixes`.
@objc(WalkTrackerPlugin)
public class WalkTrackerPlugin: CAPPlugin, CAPBridgedPlugin, WalkTrackerDelegate {
    public let identifier = "WalkTrackerPlugin"
    public let jsName = "WalkTracker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fixes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lastFixTime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
    ]

    private var tracker: WalkTracker { WalkTracker.shared }

    @objc override public func load() {
        DispatchQueue.main.async { self.tracker.delegate = self }
    }

    /// `{ walk: string }` → `{ resumed: boolean }`
    @objc func start(_ call: CAPPluginCall) {
        guard let walk = call.getString("walk"), !walk.isEmpty else {
            call.reject("Missing walk id")
            return
        }
        DispatchQueue.main.async {
            self.tracker.delegate = self
            let resumed = self.tracker.start(walkId: walk)
            call.resolve(["resumed": resumed])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tracker.stop()
            call.resolve()
        }
    }

    /// `{ from: number, after?: number }` → `{ next: number, fixes: Fix[] }`: the fixes from sequence
    /// number `from` on that are newer than `after` (ms), and the sequence number after the last one.
    @objc func fixes(_ call: CAPPluginCall) {
        let from = call.getInt("from", 0)
        let after = call.getDouble("after") ?? -Double.infinity
        DispatchQueue.main.async {
            let journal = self.tracker.journal
            let fixes = journal.fixes(from: from, after: after).map { $0.array }
            call.resolve(["next": journal.fixes.count, "fixes": fixes])
        }
    }

    /// `{ walk: string }` → `{ t: number | null }`: when the last fix of that walk was taken.
    @objc func lastFixTime(_ call: CAPPluginCall) {
        let walk = call.getString("walk")
        DispatchQueue.main.async {
            let journal = self.tracker.journal
            if let walk = walk, journal.walkId == walk, let last = journal.fixes.last {
                call.resolve(["t": last.t])
            } else {
                call.resolve(["t": NSNull()])
            }
        }
    }

    @objc func current(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tracker.current { result in
                switch result {
                case .success(let fix): call.resolve(["fix": fix.array])
                case .failure(let error): call.reject(error.localizedDescription, "unavailable", error)
                }
            }
        }
    }

    @objc func permission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["location": self.tracker.authorization.rawValue])
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tracker.requestPermission { status in
                call.resolve(["location": status.rawValue])
            }
        }
    }

    // MARK: WalkTrackerDelegate

    func walkTracker(_ tracker: WalkTracker, didRecord fix: WalkFix, seq: Int) {
        notifyListeners("fix", data: ["seq": seq, "fix": fix.array])
    }

    func walkTracker(_ tracker: WalkTracker, didFail kind: String, message: String) {
        notifyListeners("error", data: ["kind": kind, "message": message])
    }
}
