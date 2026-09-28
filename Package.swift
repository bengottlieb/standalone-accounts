// swift-tools-version: 6.2

import PackageDescription

// The Swift half of the Standalone account framework. The server library (`package.json`, `server/`) and the wire
// contract both halves test against (`contract/`) live in the same repo.
let package = Package(
	name: "AccountKit",
	platforms: [
		.iOS(.v18),
		.macOS(.v15),
	],
	products: [
		.library(name: "AccountKit", targets: ["AccountKit"]),
	],
	dependencies: [
		.package(url: "https://github.com/ios-tooling/SharedSettings", from: "1.1.5"),
	],
	targets: [
		.target(
			name: "AccountKit",
			// Linked into app extensions (StoreKeeper's notification extension): extension-safe API only. Not enforced
			// with -application-extension because SwiftPM refuses unsafe flags in remote packages.
			dependencies: [.product(name: "SharedSettings", package: "SharedSettings")]
		),
		.testTarget(name: "AccountKitTests", dependencies: ["AccountKit"]),
	]
)
