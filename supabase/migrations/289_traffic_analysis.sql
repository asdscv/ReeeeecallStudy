-- Keep HTTP requests, browser page views and article reads separate. Historical
-- rows without collection context remain unknown; zero duration is not a bot test.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.page_views ADD COLUMN tracking_hostname text;
ALTER TABLE public.page_views ADD COLUMN tracking_user_agent text;
ALTER TABLE public.page_views ADD COLUMN automation_hint boolean;
ALTER TABLE public.content_views ADD COLUMN tracking_hostname text;
ALTER TABLE public.content_views ADD COLUMN tracking_user_agent text;
ALTER TABLE public.content_views ADD COLUMN automation_hint boolean;

CREATE TABLE public.analytics_internal_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.analytics_visit_annotations (
  kind text NOT NULL CHECK (kind IN ('page','content','request')),
  event_id uuid NOT NULL,
  classification text NOT NULL CHECK (classification IN ('external','internal','bot','suspected_bot','unknown')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind,event_id)
);
CREATE TABLE public.analytics_http_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  hostname text NOT NULL,
  page_path text NOT NULL,
  user_agent text,
  referrer text,
  country text,
  asn bigint,
  verified_bot boolean,
  response_status integer NOT NULL CHECK (response_status BETWEEN 100 AND 599)
);
CREATE INDEX analytics_http_requests_date ON public.analytics_http_requests(created_at DESC,id);
ALTER TABLE public.analytics_internal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_visit_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_http_requests ENABLE ROW LEVEL SECURITY;
-- No client table access: writes and reads below have explicit authority checks.
REVOKE ALL ON public.analytics_internal_accounts, public.analytics_visit_annotations,
  public.analytics_http_requests FROM anon, authenticated;

CREATE FUNCTION public._traffic_is_bot(p_ua text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT coalesce(p_ua ~* 'bot|crawler|spider|googleother|google-inspectiontool|google-extended|slurp|headless|phantomjs|lighthouse|prerender|selenium|playwright|screaming frog|semrush|ahref|ia_archiver|yandex|baidu|duckduck|facebookexternalhit|whatsapp|cohere-ai|anthropic-ai|claude-user|claude-web|perplexity-user|chatgpt-user',false)
$$;
CREATE FUNCTION public._traffic_environment(p_host text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT CASE
  WHEN p_host IS NULL OR p_host='' THEN 'unknown'
  WHEN lower(p_host) IN ('localhost','127.0.0.1','::1','[::1]')
    OR lower(p_host) ~ '(^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\.)' THEN 'development'
  WHEN lower(p_host) ~ '(\.workers\.dev|\.pages\.dev|\.vercel\.app)$'
    OR lower(p_host) ~ '^(staging|preview)[.-]' THEN 'preview'
  WHEN lower(p_host) IN ('reklue.com','www.reklue.com','reeeeecallstudy.xyz','www.reeeeecallstudy.xyz') THEN 'production'
  ELSE 'unknown' END
$$;
REVOKE ALL ON FUNCTION public._traffic_is_bot(text), public._traffic_environment(text) FROM PUBLIC;

-- A new name avoids the ambiguous overloads of the legacy recording RPCs.
CREATE FUNCTION public.record_browser_view(p_kind text, p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_session text := left(p_payload->>'p_session_id',100);
BEGIN
 IF p_kind='page' THEN
  IF p_payload->>'p_page_path' IS NULL OR p_payload->>'p_page_path' !~ '^/'
    OR p_payload->>'p_page_path' ~ '^/(admin|auth/(callback|reset-password))(/|$)' THEN RETURN NULL; END IF;
  v_id := public.record_page_view(
    p_page_path := p_payload->>'p_page_path', p_session_id := v_session,
    p_referrer := p_payload->>'p_referrer', p_referrer_domain := p_payload->>'p_referrer_domain',
    p_referrer_category := p_payload->>'p_referrer_category', p_utm_source := p_payload->>'p_utm_source',
    p_utm_medium := p_payload->>'p_utm_medium', p_utm_campaign := p_payload->>'p_utm_campaign',
    p_utm_term := p_payload->>'p_utm_term', p_utm_content := p_payload->>'p_utm_content',
    p_device_type := p_payload->>'p_device_type', p_viewport_width := (p_payload->>'p_viewport_width')::integer);
  UPDATE public.page_views SET tracking_hostname=left(p_payload->>'hostname',255),
    tracking_user_agent=left(p_payload->>'user_agent',500), automation_hint=(p_payload->>'automation_hint')::boolean
    WHERE id=v_id AND viewer_id IS NOT DISTINCT FROM auth.uid() AND session_id IS NOT DISTINCT FROM v_session;
 ELSIF p_kind='content' THEN
  v_id := public.record_content_view(
    p_content_id := (p_payload->>'p_content_id')::uuid, p_session_id := v_session,
    p_referrer := p_payload->>'p_referrer', p_referrer_domain := p_payload->>'p_referrer_domain',
    p_referrer_category := p_payload->>'p_referrer_category', p_utm_source := p_payload->>'p_utm_source',
    p_utm_medium := p_payload->>'p_utm_medium', p_utm_campaign := p_payload->>'p_utm_campaign',
    p_utm_term := p_payload->>'p_utm_term', p_utm_content := p_payload->>'p_utm_content',
    p_device_type := p_payload->>'p_device_type', p_viewport_width := (p_payload->>'p_viewport_width')::integer);
  UPDATE public.content_views SET tracking_hostname=left(p_payload->>'hostname',255),
    tracking_user_agent=left(p_payload->>'user_agent',500), automation_hint=(p_payload->>'automation_hint')::boolean
    WHERE id=v_id AND viewer_id IS NOT DISTINCT FROM auth.uid() AND session_id IS NOT DISTINCT FROM v_session;
 ELSE RAISE EXCEPTION 'Invalid view kind'; END IF;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.record_browser_view(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_browser_view(text,jsonb) TO anon,authenticated;

-- Only the Worker service key can supply edge observations. No IPs or cookies.
CREATE FUNCTION public.record_traffic_request(p_payload jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
 INSERT INTO public.analytics_http_requests(hostname,page_path,user_agent,referrer,country,asn,verified_bot,response_status)
 SELECT left(p_payload->>'hostname',255),left(p_payload->>'page_path',500),
   left(p_payload->>'user_agent',500),left(p_payload->>'referrer',2048),left(p_payload->>'country',2),
   (p_payload->>'asn')::bigint,(p_payload->>'verified_bot')::boolean,(p_payload->>'response_status')::integer
 WHERE p_payload->>'page_path' ~ '^/' AND p_payload->>'page_path' !~ '^/(admin|auth)(/|$)'
$$;
REVOKE ALL ON FUNCTION public.record_traffic_request(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_traffic_request(jsonb) TO service_role;

CREATE FUNCTION public._admin_traffic_rows() RETURNS TABLE (
 id uuid, kind text, created_at timestamptz, page_path text, title text,
 viewer_id uuid, session_id text, account_name text, hostname text, environment text,
 user_agent text, referrer text, referrer_domain text, source text, device text,
 viewport_width integer, utm_source text, utm_medium text, utm_campaign text,
 duration_ms integer, scroll_percent integer, country text, asn bigint,
 verified_bot boolean, response_status integer, classification text, evidence text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 WITH observations AS (
  SELECT p.id,'page'::text kind,p.created_at,p.page_path,NULL::text title,p.viewer_id,p.session_id,
   p.tracking_hostname hostname,p.tracking_user_agent user_agent,p.automation_hint,p.referrer,p.referrer_domain,
   p.referrer_category,p.device_type,p.viewport_width,p.utm_source,p.utm_medium,p.utm_campaign,
   NULL::integer duration_ms,NULL::integer scroll_percent,NULL::text country,NULL::bigint asn,
   NULL::boolean verified_bot,NULL::integer response_status FROM public.page_views p
  UNION ALL
  SELECT c.id,'content',c.created_at,'/insight/'||t.slug,t.title,c.viewer_id,c.session_id,
   c.tracking_hostname,c.tracking_user_agent,c.automation_hint,c.referrer,c.referrer_domain,
   c.referrer_category,c.device_type,c.viewport_width,c.utm_source,c.utm_medium,c.utm_campaign,
   c.view_duration_ms,c.scroll_depth_percent,NULL,NULL,NULL,NULL
   FROM public.content_views c LEFT JOIN public.contents t ON t.id=c.content_id
  UNION ALL
  SELECT r.id,'request',r.created_at,r.page_path,NULL,NULL,NULL,r.hostname,r.user_agent,NULL,
   r.referrer,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,r.country,r.asn,r.verified_bot,r.response_status
   FROM public.analytics_http_requests r
 ), contextual AS (
  SELECT o.*,public._traffic_environment(o.hostname) env,coalesce(p.display_name,'') account_name,
   p.role='admin' is_admin,a.reason internal_reason,n.classification override_class,n.reason override_reason,
   public._traffic_is_bot(o.user_agent) OR coalesce(o.automation_hint,false) OR coalesce(o.verified_bot,false) is_bot
  FROM observations o LEFT JOIN public.profiles p ON p.id=o.viewer_id
  LEFT JOIN public.analytics_internal_accounts a ON a.user_id=o.viewer_id
  LEFT JOIN public.analytics_visit_annotations n ON n.kind=o.kind AND n.event_id=o.id
 )
 SELECT c.id,c.kind,c.created_at,c.page_path,c.title,c.viewer_id,c.session_id,c.account_name,
  c.hostname,c.env,c.user_agent,c.referrer,
  coalesce(nullif(c.referrer_domain,''),substring(c.referrer from '^https?://([^/:]+)')),
  CASE WHEN c.referrer ~* '^https?://accounts\.google\.' THEN 'authentication'
    WHEN c.referrer ~* '^https?://(localhost|127\.0\.0\.1)(:|/|$)' THEN 'development'
    WHEN c.referrer ~* '^https?://(www\.)?(reklue\.com|reeeeecallstudy\.xyz)(/|$)' THEN 'internal'
    WHEN c.referrer ~* '^https?://([^/]+\.)?(google\.[a-z.]+|bing\.com|search\.yahoo\.com|duckduckgo\.com|search\.naver\.com|search\.daum\.net|ecosia\.org)(/|$)' THEN 'search'
    WHEN c.referrer ~* '^https?://([^/]+\.)?(facebook\.com|instagram\.com|twitter\.com|x\.com|t\.co|reddit\.com|youtube\.com|tiktok\.com|linkedin\.com)(/|$)' THEN 'social'
    ELSE coalesce(nullif(c.referrer_category,''),CASE WHEN nullif(c.referrer,'') IS NULL THEN 'direct' ELSE 'other' END) END,
  coalesce(c.device_type,CASE WHEN c.user_agent ~* 'ipad|tablet' THEN 'tablet'
    WHEN c.user_agent ~* 'mobile|android|iphone' THEN 'mobile' ELSE 'unknown' END),
  c.viewport_width,c.utm_source,c.utm_medium,c.utm_campaign,c.duration_ms,c.scroll_percent,
  c.country,c.asn,c.verified_bot,c.response_status,
  coalesce(c.override_class,CASE WHEN c.is_admin OR c.internal_reason IS NOT NULL OR c.env IN ('development','preview')
      OR c.referrer ~* '^https?://(localhost|127\.0\.0\.1)(:|/|$)' THEN 'internal'
    WHEN c.is_bot THEN 'bot'
    WHEN c.env='production' AND nullif(c.user_agent,'') IS NOT NULL THEN 'external' ELSE 'unknown' END),
  coalesce(c.override_reason,CASE WHEN c.is_admin THEN 'admin_account'
    WHEN c.internal_reason IS NOT NULL THEN c.internal_reason
    WHEN c.env IN ('development','preview') THEN 'non_production_hostname'
    WHEN c.referrer ~* '^https?://(localhost|127\.0\.0\.1)(:|/|$)' THEN 'local_referrer'
    WHEN c.verified_bot THEN 'edge_verified_bot'
    WHEN c.automation_hint THEN 'browser_automation'
    WHEN public._traffic_is_bot(c.user_agent) THEN 'known_bot_user_agent'
    WHEN c.env='production' AND nullif(c.user_agent,'') IS NOT NULL THEN 'no_known_automation_signal'
    ELSE 'missing_historical_context' END)
 FROM contextual c
$$;
REVOKE ALL ON FUNCTION public._admin_traffic_rows() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.admin_traffic_report(p_filters jsonb DEFAULT '{}',p_offset integer DEFAULT 0,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_start timestamptz := coalesce((p_filters->>'start')::timestamptz,now()-interval '30 days');
 v_end timestamptz := least(coalesce((p_filters->>'end')::timestamptz,now()),now());
 v_zone text := coalesce(p_filters->>'timezone','UTC');
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF v_end<=v_start OR v_end-v_start>interval '11 years' OR p_limit IS NULL OR p_offset IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset<0
  OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=v_zone) THEN RAISE EXCEPTION 'Invalid traffic filters'; END IF;
 IF coalesce(p_filters->>'classification','all') NOT IN ('all','external','internal','bot','suspected_bot','unknown')
  OR coalesce(p_filters->>'kind','all') NOT IN ('all','page','content','request') THEN RAISE EXCEPTION 'Invalid traffic filters'; END IF;
 WITH base AS MATERIALIZED (
  SELECT * FROM public._admin_traffic_rows() r WHERE r.created_at>=v_start AND r.created_at<v_end
   AND (coalesce(p_filters->>'kind','all')='all' OR r.kind=p_filters->>'kind')
   AND (coalesce(p_filters->>'source','all')='all' OR r.source=p_filters->>'source')
   AND (coalesce(p_filters->>'device','all')='all' OR r.device=p_filters->>'device')
   AND (coalesce(p_filters->>'environment','all')='all' OR r.environment=p_filters->>'environment')
   AND (coalesce(p_filters->>'account','')='' OR r.viewer_id::text=p_filters->>'account')
   AND (coalesce(p_filters->>'session','')='' OR r.session_id=p_filters->>'session')
   AND (coalesce(p_filters->>'search','')='' OR position(lower(left(p_filters->>'search',200)) IN
     lower(concat_ws(' ',r.page_path,r.title,r.hostname,r.referrer_domain,r.utm_source,r.utm_campaign,r.user_agent)))>0)
 ), scoped AS MATERIALIZED (
  SELECT * FROM base WHERE coalesce(p_filters->>'classification','all')='all' OR classification=p_filters->>'classification'
 ), summary AS (
  SELECT count(*) total,count(*) FILTER(WHERE kind='page') page_views,count(*) FILTER(WHERE kind='content') content_views,
   count(*) FILTER(WHERE kind='request') http_requests,
   count(DISTINCT coalesce(viewer_id::text,session_id)) FILTER(WHERE kind<>'request') visitors,
   count(DISTINCT session_id) FILTER(WHERE kind<>'request') sessions,
   count(*) FILTER(WHERE kind='content' AND duration_ms>=2000) engaged_reads,
   round(avg(duration_ms) FILTER(WHERE kind='content' AND duration_ms>0)) avg_duration_ms,
   round(avg(scroll_percent) FILTER(WHERE kind='content')) avg_scroll_percent FROM scoped
 )
 SELECT jsonb_build_object(
  'summary',(SELECT to_jsonb(s) FROM summary s),
  'classes',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT classification,count(*) FILTER(WHERE kind='page') page_views,count(*) FILTER(WHERE kind='content') content_views,
     count(*) FILTER(WHERE kind='request') http_requests FROM base GROUP BY classification ORDER BY classification) x),
  'daily',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT to_char(created_at AT TIME ZONE v_zone,'YYYY-MM-DD') date,
     count(*) FILTER(WHERE kind='page') page_views,count(*) FILTER(WHERE kind='content') content_views,
     count(*) FILTER(WHERE kind='request') http_requests FROM scoped GROUP BY 1 ORDER BY 1) x),
  'pages',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT page_path,max(title) title,count(*) FILTER(WHERE kind='page') page_views,
     count(*) FILTER(WHERE kind='content') content_views,count(*) FILTER(WHERE kind='request') http_requests,
     count(*) FILTER(WHERE kind='content' AND duration_ms>=2000) engaged_reads,
     round(avg(duration_ms) FILTER(WHERE kind='content' AND duration_ms>0)) avg_duration_ms,
     max(scroll_percent) max_scroll_percent FROM scoped GROUP BY page_path ORDER BY count(*) DESC,page_path LIMIT 30) x),
  'sources',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT source,referrer_domain,count(*) FILTER(WHERE kind='page') page_views,
     count(*) FILTER(WHERE kind='content') content_views,count(*) FILTER(WHERE kind='request') http_requests
     FROM scoped GROUP BY source,referrer_domain ORDER BY count(*) DESC,source,referrer_domain LIMIT 30) x),
  'devices',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT device,viewport_width,count(*) total FROM scoped GROUP BY device,viewport_width ORDER BY count(*) DESC,device,viewport_width LIMIT 20) x),
  'campaigns',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT utm_source,utm_medium,utm_campaign,count(*) FILTER(WHERE kind='page') page_views,
     count(*) FILTER(WHERE kind='content') content_views FROM scoped WHERE utm_source IS NOT NULL OR utm_campaign IS NOT NULL
     GROUP BY utm_source,utm_medium,utm_campaign ORDER BY count(*) DESC,utm_source,utm_medium,utm_campaign LIMIT 30) x),
  'countries',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT country,asn,count(*) http_requests FROM scoped WHERE kind='request'
     GROUP BY country,asn ORDER BY count(*) DESC,country,asn LIMIT 20) x),
  'conversions',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT e.category,e.action,count(*) total FROM public.analytics_events e
    WHERE e.created_at>=v_start AND e.created_at<v_end AND EXISTS(
      SELECT 1 FROM scoped r WHERE r.kind<>'request' AND r.session_id IS NOT NULL AND r.session_id=e.session_id)
    GROUP BY e.category,e.action ORDER BY count(*) DESC,e.category,e.action LIMIT 30) x),
  'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
    SELECT * FROM scoped ORDER BY created_at DESC,kind,id LIMIT p_limit OFFSET p_offset) x),
  'start',v_start,'end',v_end,'timezone',v_zone,
  'coverage',jsonb_build_object('first_edge_request',(SELECT min(created_at) FROM public.analytics_http_requests),
    'first_browser_context',(SELECT min(created_at) FROM public.page_views WHERE tracking_hostname IS NOT NULL))
 ) INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.admin_traffic_report(jsonb,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_traffic_report(jsonb,integer,integer) TO authenticated;

CREATE FUNCTION public.admin_traffic_accounts() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
  SELECT p.id,p.display_name,p.role,a.reason,
    (SELECT count(*) FROM public.page_views v WHERE v.viewer_id=p.id) page_views,
    (SELECT count(*) FROM public.content_views v WHERE v.viewer_id=p.id) content_views
  FROM public.profiles p LEFT JOIN public.analytics_internal_accounts a ON a.user_id=p.id
  ORDER BY (p.role='admin') DESC,p.display_name NULLS LAST,p.id) x);
END $$;
CREATE FUNCTION public.admin_set_traffic_account(p_user_id uuid,p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF nullif(trim(p_reason),'') IS NULL THEN DELETE FROM public.analytics_internal_accounts WHERE user_id=p_user_id;
 ELSE INSERT INTO public.analytics_internal_accounts(user_id,reason) VALUES(p_user_id,trim(p_reason))
 ON CONFLICT(user_id) DO UPDATE SET reason=excluded.reason,updated_at=now(),updated_by=auth.uid(); END IF;
END $$;
CREATE FUNCTION public.admin_annotate_traffic(p_kind text,p_event_id uuid,p_classification text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public._admin_traffic_rows() WHERE id=p_event_id AND kind=p_kind) THEN RAISE EXCEPTION 'Visit not found'; END IF;
 IF p_classification IS NULL THEN DELETE FROM public.analytics_visit_annotations WHERE kind=p_kind AND event_id=p_event_id;
 ELSE INSERT INTO public.analytics_visit_annotations(kind,event_id,classification,reason)
 VALUES(p_kind,p_event_id,p_classification,trim(p_reason)) ON CONFLICT(kind,event_id)
 DO UPDATE SET classification=excluded.classification,reason=excluded.reason,updated_at=now(),updated_by=auth.uid(); END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_traffic_accounts(),public.admin_set_traffic_account(uuid,text),
 public.admin_annotate_traffic(text,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_traffic_accounts(),public.admin_set_traffic_account(uuid,text),
 public.admin_annotate_traffic(text,uuid,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
