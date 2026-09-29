export interface DoctorReport {
  node: string
  platform: string
  arch: string
  authDir: string
  authExists: boolean
  writable: boolean
  files: string[]
  warnings: string[]
}
export function doctor(options?: { authDir?: string }): Promise<DoctorReport>
