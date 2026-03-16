// @ts-check

/** @type {import("syncpack").RcFile} */
const config = {
	customTypes: {
		engines: {
			path: "engines",
			strategy: "versionsByName",
		},
		packageManager: {
			path: "packageManager",
			strategy: "name@version",
		},
	},
	dependencyTypes: [
		"dev",
		"local",
		"engines",
		"overrides",
		"peer",
		"pnpmOverrides",
		"prod",
		"resolutions",
	],
	indent: "\t",
	sortExports: [],
	semverGroups: [
		{
			label: "set minimum engine versions",
			dependencyTypes: ["engines"],
			range: ">=",
		},
		{
			label: "set package manager",
			dependencyTypes: ["packageManager"],
			range: "",
		},
		{
			label: "use exact version numbers",
			dependencyTypes: [
				"dev",
				"local",
				"overrides",
				"pnpmOverrides",
				"prod",
				"resolutions",
			],
			range: "",
		},
		{
			label: "use caret ranges for peers",
			dependencyTypes: ["peer"],
			range: "^",
		},
	],
	sortFirst: [
		"name",
		"private",
		"version",
		"type",
		"sideEffects",
		"types",
		"exports",
		"engines",
		"packageManager",
		"scripts",
		"peerDependencies",
		"dependencies",
		"devDependencies",
	],
	versionGroups: [
		{
			label: "@types packages should only be under devDependencies",
			dependencies: ["@types/**"],
			dependencyTypes: ["!dev"],
			isBanned: true,
		},
		{
			label: "Use workspace protocol when installing local packages",
			dependencies: ["$LOCAL"],
			dependencyTypes: ["!local"],
			pinVersion: "workspace:*",
		},
		{
			label: "Keep published package versions in sync",
			dependencies: [
				"@schilderlabs/pitown",
				"@schilderlabs/pitown-core",
				"@schilderlabs/pitown-package",
			],
			dependencyTypes: ["local"],
			policy: "sameRange",
		},
		{
			label: "Allow pi-coding-agent peer/dev split",
			dependencies: ["@mariozechner/pi-coding-agent"],
			dependencyTypes: ["dev", "peer"],
			isIgnored: true,
		},
	],
}

module.exports = config
