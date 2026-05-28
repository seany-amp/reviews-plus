export interface PRIdentifier {
  owner: string
  repo: string
  number: number
}

export function parsePRUrl(url: string): PRIdentifier | null {
  const trimmed = url.trim()

  // Handle shorthand: {owner}/{repo}#{number}
  const shorthandMatch = trimmed.match(
    /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)#(\d+)$/
  )
  if (shorthandMatch) {
    return {
      owner: shorthandMatch[1],
      repo: shorthandMatch[2],
      number: parseInt(shorthandMatch[3], 10),
    }
  }

  // Handle full URL: https://github.com/{owner}/{repo}/pull/{number}
  // Also without protocol: github.com/{owner}/{repo}/pull/{number}
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/
  )
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      number: parseInt(urlMatch[3], 10),
    }
  }

  return null
}
