import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '../../../../stores/auth-store'
import { AppCtaBlock } from '../AppCtaBlock'
const track=vi.hoisted(()=>vi.fn())
vi.mock('../../../../hooks/useTrackEvent',()=>({useTrackEvent:()=>track}))
vi.mock('../../../../hooks/useOfficialDeck',()=>({useOfficialDeck:()=>null}))
beforeEach(()=>{useAuthStore.setState({user:null});track.mockClear()})
function draw() { return render(<MemoryRouter><AppCtaBlock props={{position:'answer',campaign:'code-break-rules',brainGuide:'codeBreak',locale:'ko'}} /></MemoryRouter>) }
describe('brain-game article conversion',()=>{
  it('a visitor signs in and returns to the actual game, with campaign attribution',()=>{
    draw()
    const link=screen.getByRole('link',{name:'두뇌훈련 시작하기'})
    const url=new URL(link.getAttribute('href')!,'https://reeeeecallstudy.xyz')
    expect(url.pathname).toBe('/auth/login')
    expect(url.searchParams.get('redirect')).toBe('/brain/play/codeBreak')
    expect(url.searchParams.get('utm_campaign')).toBe('code-break-rules')
    fireEvent.click(link)
    expect(track).toHaveBeenCalledWith({category:'content',action:'app_cta_click',label:'answer:brain'})
    expect(screen.queryByText('appCta.answer.title')).toBeNull()
  })
  it('a signed-in reader opens the game directly',()=>{
    useAuthStore.setState({user:{id:'reader'} as never})
    draw()
    expect(screen.getByRole('link',{name:'두뇌훈련 시작하기'}).getAttribute('href')).toMatch(/^\/brain\/play\/codeBreak\?/)
  })
})
