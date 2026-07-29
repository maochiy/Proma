import { describe, expect, test } from 'bun:test'
import { parseCodeSigningIdentity } from './local-code-signing-identity'

describe('固定本地代码签名身份', () => {
  test('Given security 输出有效身份 When 解析 Then 返回稳定证书 SHA 与名称', () => {
    expect(parseCodeSigningIdentity(`
      1) 0123456789ABCDEF0123456789ABCDEF01234567 "Proma Local Development"
         1 valid identities found
    `)).toEqual({
      fingerprint: '0123456789ABCDEF0123456789ABCDEF01234567',
      name: 'Proma Local Development',
    })
  })

  test('Given 当前没有有效身份 When 解析 Then 返回 undefined', () => {
    expect(parseCodeSigningIdentity('0 valid identities found')).toBeUndefined()
  })
})
