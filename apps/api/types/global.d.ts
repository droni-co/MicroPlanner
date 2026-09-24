export {}

declare module 'express-session' {

  interface SessionConfig {
    iaApiProvider: 'deepseek' | 'anthropic'
    iaApiKey: string
    devopsOrg: string
    devopsPat: string
    ghOrg: string
    ghPat: string
  }
  interface SessionData {
    config: SessionConfig
  }
}