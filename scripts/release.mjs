import fetch from 'node-fetch'
import { getOctokit, context } from '@actions/github'

const UPDATER_TAG = 'updater'
const UPDATER_FILE = 'release.json'

if (process.env.GITHUB_TOKEN === undefined) {
  throw new Error('GITHUB_TOKEN not found.')
}

const getSignature = async (url) => {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream' },
  })

  return response.text()
}

const github = getOctokit(process.env.GITHUB_TOKEN)
const { repos } = github.rest
const repoMetaData = {
  owner: context.repo.owner,
  repo: context.repo.repo,
}

const { data: latestRelease } = await repos.getLatestRelease(repoMetaData)

const macOS = {}
const linux = {}
const windows = {}

const promises = latestRelease.assets.map(async ({ name, browser_download_url }) => {
  if (name.endsWith('.app.tar.gz')) {
    macOS.url = browser_download_url
  }

  if (name.endsWith('.app.tar.gz.sig')) {
    macOS.signature = await getSignature(browser_download_url)
  }

  if (name.endsWith('.AppImage.tar.gz')) {
    linux.url = browser_download_url
  }

  if (name.endsWith('.AppImage.tar.gz.sig')) {
    linux.signature = await getSignature(browser_download_url)
  }

  if (name.endsWith('.msi.zip')) {
    windows.url = browser_download_url
  }

  if (name.endsWith('.msi.zip.sig')) {
    windows.signature = await getSignature(browser_download_url)
  }
})

await Promise.allSettled(promises)

const releaseData = {
  version: latestRelease.tag_name,
  notes: `https://github.com/${repoMetaData.owner}/${repoMetaData.repo}/releases/tag/${latestRelease.tag_name}`,
  pub_date: new Date().toISOString(),
  platforms: {},
}

if (macOS.url) {
  releaseData.platforms['darwin-aarch64'] = macOS
  releaseData.platforms['darwin-x86_64'] = macOS
} else {
  console.error('Failed to get release for MacOS')
}

if (linux.url) {
  releaseData.platforms['linux-x86_64'] = linux
} else {
  console.error('Failed to get release for Linux')
}

if (windows.url) {
  releaseData.platforms['windows-x86_64'] = windows
} else {
  console.error('Failed to get release for Windows')
}

const { data: updater } = await repos.getReleaseByTag({
  ...repoMetaData,
  tag: UPDATER_TAG,
})

const prevReleaseAsset = updater.assets.find((asset) => asset.name === UPDATER_FILE)
if (prevReleaseAsset) {
  await repos.deleteReleaseAsset({ ...repoMetaData, asset_id: prevReleaseAsset.id })
}

await repos.uploadReleaseAsset({
  ...repoMetaData,
  release_id: updater.id,
  name: UPDATER_FILE,
  data: JSON.stringify(releaseData),
})
