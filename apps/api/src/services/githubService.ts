type Repository = {
  id: number
  name: string
  full_name: string
  private: boolean
  html_url: string
  description: string | null
  default_branch: string
  language: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  archived: boolean
  updated_at: string
  owner: { login: string }
}

type RepositorySearchResponse = { total_count: number; incomplete_results: boolean; items: Repository[] }

export class GitHubService {
  private readonly organization: string
  private readonly token: string
  private readonly baseUrl = 'https://api.github.com'

  constructor(
    organization = process.env.GITHUB_ORG || '',
    token = process.env.GITHUB_TOKEN || '',
  ) {
    if (!organization || !token) throw new Error('Faltan GITHUB_ORG o GITHUB_TOKEN en el archivo .env')
    this.organization = organization
    this.token = token
  }

  async searchRepositories(query: string, top = 20): Promise<RepositorySearchResponse> {
    const search = `org:${this.organization} ${query}`.trim()
    const perPage = Math.max(1, Math.min(top, 100))
    return this.request<RepositorySearchResponse>(`/search/repositories?q=${encodeURIComponent(search)}&per_page=${perPage}`)
  }

  async getRepository(repository: string, owner = this.organization): Promise<Repository> {
    return this.request<Repository>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`)
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`GitHub respondió ${response.status}: ${detail || response.statusText}`)
    }
    return response.json() as Promise<T>
  }
}
