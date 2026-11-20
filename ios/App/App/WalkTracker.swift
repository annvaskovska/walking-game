import CoreLocation
import Foundation

/// One GPS fix, in the shape the web app's `Fix` has: degrees, metres, ms since 1970, m/s, degrees.
struct WalkFix: Equatable {
    let lon: Double
    let lat: Double
    let acc: Double
    let t: Double
    let speed: Double?
    let heading: Double?

    init(lon: Double, lat: Double, acc: Double, t: Double, speed: Double?, heading: Double?) {
        self.lon = lon
        self.lat = lat
        self.acc = acc
        self.t = t
        self.speed = speed
        self.heading = heading
    }

    init(_ location: CLLocation) {
        lon = location.coordinate.longitude
        lat = location.coordinate.latitude
        acc = location.horizontalAccuracy
        t = (location.timestamp.timeIntervalSince1970 * 1000).rounded()
        speed = location.speed >= 0 ? location.speed : nil
        heading = location.course >= 0 ? location.course : nil
    }

    /// [lon, lat, acc, t, speed, heading], with NSNull for a missing speed or heading: small to keep
    /// on disk and to hand to the web view.
    var array: [Any] {
        [lon, lat, acc, t, speed ?? NSNull(), heading ?? NSNull()]
    }

    init?(array: [Any]) {
        guard array.count >= 4,
              let lon = (array[0] as? NSNumber)?.doubleValue,
              let lat = (array[1] as? NSNumber)?.doubleValue,
              let acc = (array[2] as? NSNumber)?.doubleValue,
              let t = (array[3] as? NSNumber)?.doubleValue else { return nil }
        let speed = array.count > 4 ? (array[4] as? NSNumber)?.doubleValue : nil
        let heading = array.count > 5 ? (array[5] as? NSNumber)?.doubleValue : nil
        self.init(lon: lon, lat: lat, acc: acc, t: t, speed: speed, heading: heading)
    }
}

/// Every fix of the walk in progress, in memory and in a file, so nothing walked with the screen
/// locked is lost: not when iOS pauses the web view, not when it reloads it, not even when it ends
/// the app. The web app reads it back by sequence number (the fix's index here).
///
/// The file is JSON lines: a header `{"walk":"<id>"}`, then one fix array per line. A line cut short
/// by a crash is skipped on the next read.
final class WalkJournal {
    private(set) var walkId: String?
    private(set) var fixes: [WalkFix] = []
    private let url: URL
    private var handle: FileHandle?

    init(url: URL) {
        self.url = url
        load()
    }

    static var defaultURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Wanderlight", isDirectory: true).appendingPathComponent("walk.jsonl")
    }

    /// Keep the journal of this walk if it is the one on disk (the app was reloaded mid-walk), else
    /// start an empty one. Returns true when it carried on.
    @discardableResult
    func begin(walkId id: String) -> Bool {
        if walkId == id { return true }
        clear()
        walkId = id
        let fm = FileManager.default
        try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let header = (try? JSONSerialization.data(withJSONObject: ["walk": id])) ?? Data()
        #if os(iOS)
        // Written to with the phone locked: readable after the first unlock since it was switched on.
        let attributes: [FileAttributeKey: Any] = [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        #else
        let attributes: [FileAttributeKey: Any] = [:]
        #endif
        fm.createFile(atPath: url.path, contents: header + Data([0x0A]), attributes: attributes)
        return false
    }

    /// Adds a fix and returns its sequence number.
    @discardableResult
    func append(_ fix: WalkFix) -> Int {
        fixes.append(fix)
        if walkId != nil, let line = try? JSONSerialization.data(withJSONObject: fix.array) {
            write(line + Data([0x0A]))
        }
        return fixes.count - 1
    }

    /// Fixes from sequence number `from` on, leaving out those not newer than `after` (ms).
    func fixes(from: Int, after: Double) -> [WalkFix] {
        let start = max(0, min(from, fixes.count))
        return fixes[start...].filter { $0.t > after }
    }

    /// The walk ended: forget it.
    func clear() {
        try? handle?.close()
        handle = nil
        walkId = nil
        fixes = []
        try? FileManager.default.removeItem(at: url)
    }

    private func write(_ data: Data) {
        if handle == nil {
            handle = try? FileHandle(forWritingTo: url)
            _ = try? handle?.seekToEnd()
        }
        do {
            try handle?.write(contentsOf: data)
        } catch {
            try? handle?.close()
            handle = nil
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: url), !data.isEmpty else { return }
        let lines = data.split(separator: 0x0A, omittingEmptySubsequences: true)
        guard let first = lines.first,
              let header = (try? JSONSerialization.jsonObject(with: Data(first))) as? [String: Any],
              let id = header["walk"] as? String else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        walkId = id
        for line in lines.dropFirst() {
            if let array = (try? JSONSerialization.jsonObject(with: Data(line))) as? [Any], let fix = WalkFix(array: array) {
                fixes.append(fix)
            }
        }
        // Close a line cut short, so the next fix starts on a line of its own.
        if data.last != 0x0A { write(Data([0x0A])) }
    }
}

enum WalkAuthorization: String {
    case granted, denied, prompt
}

protocol WalkTrackerDelegate: AnyObject {
    func walkTracker(_ tracker: WalkTracker, didRecord fix: WalkFix, seq: Int)
    /// `kind` is one of the web app's LocationErrorKind values: denied, unavailable or timeout.
    func walkTracker(_ tracker: WalkTracker, didFail kind: String, message: String)
}

/// The phone's GPS for a walk. Started while the app is open, it goes on with the screen locked or
/// another app in front (the "location" background mode, with only While Using permission; iOS
/// shows the blue location pill meanwhile) until the walk ends.
///
/// Use it on the main thread: Core Location calls its delegate on the thread that made the manager.
final class WalkTracker: NSObject, CLLocationManagerDelegate {
    static let shared = WalkTracker()

    weak var delegate: WalkTrackerDelegate?
    let journal: WalkJournal
    private let manager = CLLocationManager()
    /// A walk is on: GPS runs, or will as soon as permission is given.
    private(set) var walking = false
    private var updating = false
    private var permissionWaiters: [(WalkAuthorization) -> Void] = []
    private var oneShotWaiters: [(Result<WalkFix, Error>) -> Void] = []
    #if os(iOS)
    private var backgroundSession: AnyObject?
    #endif

    init(journal: WalkJournal = WalkJournal(url: WalkJournal.defaultURL)) {
        self.journal = journal
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = false
    }

    var authorization: WalkAuthorization {
        switch manager.authorizationStatus {
        case .notDetermined: return .prompt
        // Also what it reports while Location Services are off for the whole phone.
        case .denied, .restricted: return .denied
        default: return .granted
        }
    }

    /// Start (or carry on with) the walk `walkId`. Asks for permission the first time.
    /// Returns true when the journal already held this walk (the app was reloaded mid-walk).
    @discardableResult
    func start(walkId: String) -> Bool {
        let resumed = journal.begin(walkId: walkId)
        walking = true
        switch authorization {
        case .granted: beginUpdates()
        case .prompt: ask()
        case .denied: delegate?.walkTracker(self, didFail: "denied", message: "Location is off for Wanderlight.")
        }
        return resumed
    }

    /// The walk ended: stop the GPS and forget its journal.
    func stop() {
        walking = false
        endUpdates()
        journal.clear()
    }

    func requestPermission(_ done: @escaping (WalkAuthorization) -> Void) {
        if authorization != .prompt {
            done(authorization)
            return
        }
        permissionWaiters.append(done)
        ask()
    }

    /// One position, for a map to centre on.
    func current(_ done: @escaping (Result<WalkFix, Error>) -> Void) {
        if let last = manager.location, -last.timestamp.timeIntervalSinceNow < 60, last.horizontalAccuracy >= 0 {
            done(.success(WalkFix(last)))
            return
        }
        oneShotWaiters.append(done)
        if authorization == .prompt { ask() } else { manager.requestLocation() }
    }

    private func ask() {
        // While Using is enough: updates started in the app go on in the background.
        manager.requestWhenInUseAuthorization()
    }

    private func beginUpdates() {
        guard walking, !updating else { return }
        updating = true
        #if os(iOS)
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        if #available(iOS 17.0, *), backgroundSession == nil {
            backgroundSession = CLBackgroundActivitySession()
        }
        if #available(iOS 14.0, *), manager.accuracyAuthorization == .reducedAccuracy {
            // Approximate location can't tell one street from the next: ask for precise, for this walk.
            manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "WalkStreets")
        }
        #endif
        manager.startUpdatingLocation()
    }

    private func endUpdates() {
        guard updating else { return }
        updating = false
        manager.stopUpdatingLocation()
        #if os(iOS)
        manager.allowsBackgroundLocationUpdates = false
        if #available(iOS 17.0, *) {
            (backgroundSession as? CLBackgroundActivitySession)?.invalidate()
        }
        backgroundSession = nil
        #endif
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = authorization
        if status == .prompt { return }
        let waiters = permissionWaiters
        permissionWaiters = []
        waiters.forEach { $0(status) }
        if status == .granted {
            if walking { beginUpdates() }
            if !oneShotWaiters.isEmpty { manager.requestLocation() }
        } else {
            endUpdates()
            failOneShots(CLError(.denied))
            if walking { delegate?.walkTracker(self, didFail: "denied", message: "Location is off for Wanderlight.") }
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 {
            let fix = WalkFix(location)
            let waiters = oneShotWaiters
            oneShotWaiters = []
            waiters.forEach { $0(.success(fix)) }
            guard walking else { continue }
            if let last = journal.fixes.last, fix.t <= last.t { continue }
            let seq = journal.append(fix)
            delegate?.walkTracker(self, didRecord: fix, seq: seq)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        failOneShots(error)
        guard walking else { return }
        switch code {
        case .denied?:
            // Handled by the authorization change that comes with it.
            return
        case .locationUnknown?:
            // No fix right now; Core Location keeps trying.
            delegate?.walkTracker(self, didFail: "timeout", message: error.localizedDescription)
        default:
            delegate?.walkTracker(self, didFail: "unavailable", message: error.localizedDescription)
        }
    }

    private func failOneShots(_ error: Error) {
        let waiters = oneShotWaiters
        oneShotWaiters = []
        waiters.forEach { $0(.failure(error)) }
    }
}
