type WorkItem = {
  id: number
  rev: number
  fields: Record<string, unknown>
  url: string
  _links?: Record<string, unknown>
}

type WorkItemReference = { id: number; url: string }

type WorkItemQueryResponse = { workItems?: WorkItemReference[] }

type WorkItemBatchResponse = { value?: WorkItem[] }

type WorkItemOptions = {
  top?: number
  type?: string
  state?: string
}

type Project = {
  id: string
  name: string
  description?: string
  url: string
  state: string
  revision?: number
  visibility?: string
  lastUpdateTime?: string
}

type ProjectListResponse = { value?: Project[] }

export type UpdateWorkItemInput = {
  fields: Record<string, unknown>
}

export class AzureDevOpsService {
  private readonly organization: string
  private readonly pat: string
  private readonly baseUrl: string

  constructor(
    organization = process.env.AZURE_DEVOPS_ORG || '',
    pat = process.env.AZURE_DEVOPS_PAT || '',
  ) {
    if (!organization || !pat) throw new Error('Faltan AZURE_DEVOPS_ORG o AZURE_DEVOPS_PAT en el archivo .env')
    this.organization = organization
    this.pat = pat
    this.baseUrl = `https://dev.azure.com/${encodeURIComponent(organization)}`
  }

  async listProjects(): Promise<Project[]> {
    const result = await this.request<ProjectListResponse>('/_apis/projects?$top=100&api-version=7.1')
    return result.value || []
  }

  async getProject(project: string): Promise<Project> {
    return this.request<Project>(`/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`)
  }

  async listWorkItems(project: string, options: WorkItemOptions = {}): Promise<WorkItem[]> {
    const clauses = [`[System.TeamProject] = '${this.escapeWiql(project)}'`]
    if (options.type) clauses.push(`[System.WorkItemType] = '${this.escapeWiql(options.type)}'`)
    if (options.state) clauses.push(`[System.State] = '${this.escapeWiql(options.state)}'`)
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [System.ChangedDate] DESC`
    return this.executeWiql(project, wiql, options.top)
  }

  async getWorkItem(id: number): Promise<WorkItem> {
    return this.request<WorkItem>(`/_apis/wit/workitems/${id}?api-version=7.1`)
  }

  async updateWorkItem(id: number, input: UpdateWorkItemInput): Promise<WorkItem> {
    const operations = Object.entries(input.fields).map(([field, value]) => ({
      op: 'add',
      path: `/fields/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      value,
    }))

    if (!operations.length) throw new Error('Debes enviar al menos un campo para actualizar')
    return this.request<WorkItem>(`/_apis/wit/workitems/${id}?api-version=7.1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify(operations),
    })
  }

  async searchWorkItems(project: string, query: string, top = 20): Promise<WorkItem[]> {
    const escapedQuery = this.escapeWiql(query)
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${this.escapeWiql(project)}' AND (CONTAINS([System.Title], '${escapedQuery}') OR CONTAINS([System.Description], '${escapedQuery}')) ORDER BY [System.ChangedDate] DESC`
    return this.executeWiql(project, wiql, top)
  }

  private async executeWiql(project: string, wiql: string, top = 20): Promise<WorkItem[]> {
    const result = await this.request<WorkItemQueryResponse>(`/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=7.1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: wiql }),
    })
    const ids = (result.workItems || []).slice(0, Math.max(1, Math.min(top, 200))).map((item) => item.id)
    if (!ids.length) return []
    return this.request<WorkItemBatchResponse>(`/_apis/wit/workitems?ids=${ids.join(',')}&api-version=7.1`).then((batch) => batch.value || [])
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${btoa(`:${this.pat}`)}`,
        Accept: 'application/json',
        ...init.headers,
      },
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Azure DevOps respondió ${response.status}: ${detail || response.statusText}`)
    }
    return response.json() as Promise<T>
  }

  private escapeWiql(value: string): string {
    return value.replace(/'/g, "''")
  }
}
