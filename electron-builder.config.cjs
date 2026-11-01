const fs = require('node:fs')
const path = require('node:path')

const plainNamesByArchName = {
  'Fetch-My-Recordings-Mac-universal.dmg': 'Fetch-My-Recordings-Mac.dmg',
  'Fetch-My-Recordings-Mac-arm64.dmg': 'Fetch-My-Recordings-Mac-Apple-Chip.dmg',
  'Fetch-My-Recordings-Mac-x64.dmg': 'Fetch-My-Recordings-Mac-Intel.dmg',
  'Fetch-My-Recordings-Linux-x86_64.AppImage': 'Fetch-My-Recordings-Linux.AppImage',
  'Fetch-My-Recordings-Linux-arm64.AppImage': 'Fetch-My-Recordings-Linux-ARM.AppImage'
}

module.exports = {
  appId: 'io.github.furey.fetch-my-recordings',
  productName: 'Fetch My Recordings',
  copyright: 'Copyright © James Furey. GPL-3.0-or-later. An independent tool, not made, endorsed, or supported by Fetch TV.',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'package.json'],
  asar: true,
  electronLanguages: ['en', 'en-GB', 'en_GB'],
  extraMetadata: { main: 'dist/main.mjs' },
  publish: null,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['universal', 'arm64', 'x64'] }
    ],
    icon: 'build/icon.png',
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    category: 'public.app-category.utilities',
    extendInfo: {
      NSLocalNetworkUsageDescription: 'Fetch My Recordings looks for your Fetch box on your home network and copies your recordings from it.'
    }
  },
  dmg: {
    sign: false,
    format: 'ULFO',
    title: 'Fetch My Recordings ${version}',
    artifactName: 'Fetch-My-Recordings-Mac-${arch}.${ext}'
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    signAndEditExecutable: process.platform === 'win32'
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    shortcutName: 'Fetch My Recordings',
    artifactName: 'Fetch-My-Recordings-Windows.${ext}'
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64', 'arm64'] }],
    category: 'AudioVideo',
    executableName: 'fetch-my-recordings',
    icon: 'build/icons',
    synopsis: 'Copy the recordings on a Fetch box to this computer.'
  },
  appImage: { artifactName: 'Fetch-My-Recordings-Linux-${arch}.${ext}' },
  afterAllArtifactBuild: ({ artifactPaths }) => {
    artifactPaths.forEach(renameToPlainName)
    return []
  }
}

const renameToPlainName = (artifactPath) => {
  const plainName = plainNamesByArchName[path.basename(artifactPath)]
  if (!plainName) return
  fs.renameSync(artifactPath, path.join(path.dirname(artifactPath), plainName))
}
