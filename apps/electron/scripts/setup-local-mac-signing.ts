#!/usr/bin/env bun
import { setupLocalCodeSigningIdentity } from './local-code-signing-identity'

const identity = setupLocalCodeSigningIdentity({
  trust: process.argv.includes('--trust'),
})
console.log(`[本地签名] 固定身份已就绪: ${identity.name}`)
console.log(`[本地签名] 证书指纹: ${identity.fingerprint}`)
console.log(`[本地签名] Keychain: ${identity.keychainPath}`)
