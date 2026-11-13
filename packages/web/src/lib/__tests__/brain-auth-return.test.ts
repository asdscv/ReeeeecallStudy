import { beforeEach,describe,expect,it } from 'vitest'
import { safeBrainAuthReturn,rememberBrainAuthReturn,consumeBrainAuthReturn } from '../brain-auth-return'
beforeEach(()=>sessionStorage.clear())
describe('brain article OAuth destination',()=>{
  it('only accepts existing internal brain routes',()=>{
    for(const path of ['/brain','/brain/training','/brain/play/codeBreak','/brain/play/makeNumber?utm_source=blog']) expect(safeBrainAuthReturn(path)).toBe(path)
    for(const path of ['https://evil.test','//evil.test','/\\evil.test','/brain/play/quickEye','/dashboard','/brain/play/unknown','/brain/../auth/login','/brain#token']) {
      if(path==='/brain#token')expect(safeBrainAuthReturn(path)).toBe('/brain')
      else expect(safeBrainAuthReturn(path)).toBeNull()
    }
  })
  it('consumes a destination once and clears stale destinations on unrelated sign-in',()=>{
    rememberBrainAuthReturn('/brain/play/codeBreak')
    expect(consumeBrainAuthReturn()).toBe('/brain/play/codeBreak')
    expect(consumeBrainAuthReturn()).toBeNull()
    rememberBrainAuthReturn('/brain/play/mazeRun')
    rememberBrainAuthReturn(null)
    expect(consumeBrainAuthReturn()).toBeNull()
  })
})
