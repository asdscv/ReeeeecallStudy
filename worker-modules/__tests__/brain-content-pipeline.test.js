import { it, expect, vi } from 'vitest'
vi.mock('../logger.js',()=>({createLogger:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()}))
vi.mock('../keyword-planner.js',()=>({planKeywordTopic:vi.fn(),planDeckTopic:vi.fn()}))
vi.mock('../topic-generator.js',()=>({generateTopics:vi.fn()}))
vi.mock('../ai-client.js',()=>({callAI:vi.fn(),generateImage:vi.fn()}))
vi.mock('../supabase-client.js',()=>({createSupabaseClient:vi.fn()}))
vi.mock('../indexnow.js',()=>({submitToIndexNow:vi.fn()}))
import { runContentPipeline } from '../content-pipeline.js'
import { planKeywordTopic } from '../keyword-planner.js'
import { generateTopics } from '../topic-generator.js'
import { callAI,generateImage } from '../ai-client.js'
import { createSupabaseClient } from '../supabase-client.js'
import { brainTopic } from '../brain-content.js'
import { brainGuide,brainContentTags } from '../../packages/shared/lib/brain-content.ts'

const clean=()=>({title:'Bulls and Cows rules',slug:'bulls-and-cows-rules',meta_title:'Bulls and Cows rules',meta_description:'Use strikes and balls to find the secret code.',tags:['puzzle','brain-game-setmatch'],reading_time_minutes:5,
content_blocks:[{type:'hero',props:{title:'Bulls and Cows rules'}},...Array.from({length:5},()=>({type:'paragraph',props:{text:'Use each guess and its feedback to narrow the possibilities.'}})),{type:'cta',props:{title:'Play',description:'Try the game.',buttonText:'Start',buttonUrl:'/wrong-game'}}]})

it('the daily brain topic retries a health claim, saves four linked editions, and preserves only its own game tag',async()=>{
  const records=[]
  planKeywordTopic.mockResolvedValue(brainTopic(brainGuide('codeBreak')))
  generateImage.mockRejectedValue(new Error('no image'))
  const bad=clean();bad.content_blocks[1].props.text='This prevents dementia.'
  callAI.mockResolvedValueOnce(bad).mockImplementation(async()=>clean())
  createSupabaseClient.mockReturnValue({getRecentContent:async()=>[],insertContent:async r=>{records.push(r);return {...r,id:r.locale}}})
  await runContentPipeline({},'0 6 * * *')
  expect(callAI).toHaveBeenCalledTimes(5)
  expect(generateTopics).not.toHaveBeenCalled()
  expect(records.map(r=>r.locale).sort()).toEqual(['en','ja','ko','vi'])
  expect(new Set(records.map(r=>r.slug)).size).toBe(1)
  for(const record of records){
    expect(record.tags).toEqual(expect.arrayContaining(brainContentTags('codeBreak')))
    expect(record.tags).not.toContain('brain-game-setmatch')
    expect(record.target_query).toBe('숫자 야구 하는 법')
    expect(record.deck_family).toBeUndefined()
    expect(record.content_blocks.at(-1).props.buttonUrl).toContain('redirect=%2Fbrain%2Fplay%2FcodeBreak')
    expect(JSON.stringify(record.content_blocks)).not.toContain('dementia')
  }
})

it('generated numeric puzzles are replaced by an engine-calculated example before publication',async()=>{
  vi.clearAllMocks()
  const records=[]
  planKeywordTopic.mockResolvedValue(brainTopic(brainGuide('codeBreak')))
  generateImage.mockRejectedValue(new Error('no image'))
  const bad=clean();bad.content_blocks[1].props.text='Guess 12, then 23. The secret is 32.'
  callAI.mockResolvedValueOnce(bad).mockImplementation(async()=>clean())
  createSupabaseClient.mockReturnValue({getRecentContent:async()=>[],insertContent:async r=>{records.push(r);return {...r,id:r.locale}}})
  await runContentPipeline({},'0 6 * * *')
  expect(callAI).toHaveBeenCalledTimes(5)
  expect(callAI.mock.calls[1][2]).toContain('do not generate numeric examples')
  expect(records).toHaveLength(4)
  for(const r of records) {
    const example=r.content_blocks.find(b=>b.type==='numbered_list')
    expect(example.props.items.map(i=>i.heading)).toEqual(expect.arrayContaining([expect.stringContaining('41'),expect.stringContaining('21'),expect.stringContaining('42')]))
    expect(example.props.items[2].description).toContain(': 42.')
  }
})
