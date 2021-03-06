/**

Copyright 2019 Forestry.io Inc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

*/

import { b64EncodeUnicode } from './base64'
import Cookies from 'js-cookie'
import { authenticate } from './authenticate'
export * from './authenticate'

export interface GithubClientOptions {
  proxy: string
  clientId: string
  authCallbackRoute: string
  baseRepoFullName: string
  baseBranch?: string
  authScope?: AuthScope
}

export interface Branch {
  name: string
  protected: boolean
}

export type AuthScope = 'public_repo' | 'repo'

export class GithubClient {
  static WORKING_REPO_COOKIE_KEY = 'working_repo_full_name'
  static HEAD_BRANCH_COOKIE_KEY = 'head_branch'

  proxy: string
  baseRepoFullName: string
  baseBranch: string
  clientId: string
  authCallbackRoute: string
  authScope: AuthScope

  constructor({
    proxy,
    clientId,
    authCallbackRoute,
    baseRepoFullName,
    baseBranch = 'master',
    authScope = 'public_repo',
  }: GithubClientOptions) {
    this.proxy = proxy
    this.baseRepoFullName = baseRepoFullName
    this.baseBranch = baseBranch
    this.clientId = clientId
    this.authCallbackRoute = authCallbackRoute
    this.authScope = authScope
    this.validate()
  }

  authenticate() {
    return authenticate(this.clientId, this.authCallbackRoute, this.authScope)
  }

  isAuthenticated() {
    return this.getUser()
  }

  get isFork() {
    return this.workingRepoFullName !== this.baseRepoFullName
  }

  async isAuthorized() {
    const repo = await this.getRepository()

    return repo.permissions.push
  }

  async getUser() {
    try {
      const data = await this.req({
        url: `https://api.github.com/user`,
        method: 'GET',
      })

      return data
    } catch (e) {
      if ((e.status = 401)) {
        return
      }
      throw e
    }
  }

  getRepository() {
    return this.req({
      url: `https://api.github.com/repos/${this.workingRepoFullName}`,
    })
  }

  async createFork() {
    const fork = await this.req({
      url: `https://api.github.com/repos/${this.baseRepoFullName}/forks`,
      method: 'POST',
    })

    this.setCookie(GithubClient.WORKING_REPO_COOKIE_KEY, fork.full_name)

    return fork
  }

  createPR(title: string, body: string) {
    const workingRepoFullName = this.workingRepoFullName
    const headBranch = this.branchName

    return this.req({
      url: `https://api.github.com/repos/${this.baseRepoFullName}/pulls`,
      method: 'POST',
      data: {
        title: title ? title : 'Update from TinaCMS',
        body: body ? body : 'Please pull these awesome changes in!',
        head: `${workingRepoFullName.split('/')[0]}:${headBranch}`,
        base: this.baseBranch,
      },
    })
  }

  get workingRepoFullName(): string {
    const forkName = this.getCookie(GithubClient.WORKING_REPO_COOKIE_KEY)

    if (forkName) {
      return forkName
    }

    this.setCookie(GithubClient.WORKING_REPO_COOKIE_KEY, this.baseRepoFullName)

    return this.baseRepoFullName
  }

  get branchName(): string {
    const branchName = this.getCookie(GithubClient.HEAD_BRANCH_COOKIE_KEY)

    if (branchName) {
      return branchName
    }

    this.setCookie(GithubClient.HEAD_BRANCH_COOKIE_KEY, this.baseBranch)

    return this.branchName
  }

  setWorkingBranch(branch: string) {
    this.setCookie(GithubClient.HEAD_BRANCH_COOKIE_KEY, branch)
  }

  async fetchExistingPR() {
    const workingRepoFullName = this.workingRepoFullName
    const headBranch = this.branchName

    const branches = await this.req({
      url: `https://api.github.com/repos/${this.baseRepoFullName}/pulls`,
      method: 'GET',
    })

    for (let i = 0; i < branches.length; i++) {
      const pull = branches[i]
      if (headBranch === pull.head.ref) {
        if (
          pull.head.repo?.full_name === workingRepoFullName &&
          pull.base.repo?.full_name === this.baseRepoFullName
        ) {
          return pull // found matching PR
        }
      }
    }

    return
  }

  async getBranch() {
    try {
      const workingRepoFullName = this.workingRepoFullName
      const branch = this.branchName

      const data = await this.req({
        url: `https://api.github.com/repos/${workingRepoFullName}/git/ref/heads/${branch}`,
        method: 'GET',
      })
      return data
    } catch (e) {
      if ((e.status = 404)) {
        return
      }
      throw e
    }

    // TODO
    // if (data.ref.startsWith('refs/heads/')) {
    //   //check if branch, and not tag
    //   return data
    // }
    // return // Bubble up error here?
  }

  async getBranchList(): Promise<Branch[]> {
    return await this.req({
      url: `https://api.github.com/repos/${this.workingRepoFullName}/branches`,
      method: 'GET',
    })
  }

  async createBranch(name: string) {
    const currentBranch = await this.getBranch()
    console.log({ currentBranch })
    let sha = currentBranch.object.sha
    return this.req({
      url: `https://api.github.com/repos/${this.workingRepoFullName}/git/refs`,
      method: 'POST',
      data: {
        ref: `refs/heads/${name}`,
        sha,
      },
    })
  }

  async commit(
    filePath: string,
    sha: string,
    fileContents: string,
    commitMessage: string = 'Update from TinaCMS'
  ) {
    const repo = this.workingRepoFullName
    const branch = this.branchName

    return this.req({
      url: `https://api.github.com/repos/${repo}/contents/${filePath}`,
      method: 'PUT',
      data: {
        message: commitMessage,
        content: b64EncodeUnicode(fileContents),
        sha,
        branch: branch,
      },
    })
  }

  async upload(
    path: string,
    fileContents: string,
    commitMessage: string = 'Update from TinaCMS',
    encoded: boolean = false
  ) {
    const repo = this.workingRepoFullName
    const branch = this.branchName

    return this.req({
      url: `https://api.github.com/repos/${repo}/contents/${path}`,
      method: 'PUT',
      data: {
        message: commitMessage,
        content: encoded ? fileContents : b64EncodeUnicode(fileContents),
        branch: branch,
      },
    })
  }

  private async req(data: any) {
    const response = await this.proxyRequest(data)
    return this.getGithubResponse(response)
  }

  private async getGithubResponse(response: Response) {
    const data = await response.json()
    //2xx status codes
    if (response.status.toString()[0] == '2') return data

    throw new GithubError(response.statusText, response.status)
  }

  private validate(): void {
    const errors = []
    if (!this.proxy) {
      errors.push('Missing `proxy` URL')
    }
    if (!this.authCallbackRoute) {
      errors.push('Missing `authCallbackRoute`')
    }
    if (!this.baseRepoFullName) {
      errors.push(
        'Missing `baseRepoFullName`. It may not have been set in environment variables.'
      )
    }
    if (!this.clientId) {
      errors.push(
        'Missing `clientId`. It may not have been set in environment variables.'
      )
    }
    if (errors.length) {
      throw new Error(createErrorMessage(errors))
    }
  }

  /**
   * The methods below maybe don't belong on GitHub client, but it's fine for now.
   */
  private proxyRequest(data: any) {
    return fetch(this.proxy, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  private getCookie(cookieName: string): string | undefined {
    return Cookies.get(cookieName)
  }

  private setCookie(cookieName: string, val: string) {
    Cookies.set(cookieName, val, { sameSite: 'strict' })
  }
}

class GithubError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.message = message
    this.status = status
  }
}

const createErrorMessage = (
  errors: string[]
) => `Failed to create the TinaCMS GithubClient

${errors.map(error => `\t* ${error}`).join('\n')}

Visit the setup guide for more information

\thttps://tinacms.org/guides/nextjs/github-open-authoring/configure-custom-app
`
