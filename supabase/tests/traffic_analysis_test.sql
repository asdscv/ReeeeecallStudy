\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('f9000000-0000-4000-8000-000000000001'),('f9000000-0000-4000-8000-000000000002');
-- Fixture bootstrap: role updates are correctly forbidden before an admin exists.
DELETE FROM public.profiles WHERE id='f9000000-0000-4000-8000-000000000001';
INSERT INTO public.profiles(id,role) VALUES('f9000000-0000-4000-8000-000000000001','admin');
DO $$
DECLARE q jsonb; v_id uuid; v_legacy uuid; v_content uuid;
 f jsonb := jsonb_build_object('start',now()-interval '1 day','end',now()+interval '1 day','search','traffic-audit-','timezone','Asia/Seoul');
BEGIN
 -- A grant check also catches default PUBLIC EXECUTE on SECURITY DEFINER helpers.
 ASSERT NOT has_function_privilege('anon','public.admin_traffic_report(jsonb,integer,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public._admin_traffic_rows()','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.record_traffic_request(jsonb)','EXECUTE');
 ASSERT NOT has_table_privilege('authenticated','public.analytics_http_requests','SELECT');
 ASSERT NOT has_table_privilege('anon','public.analytics_internal_accounts','SELECT');
 ASSERT has_function_privilege('service_role','public.record_traffic_request(jsonb)','EXECUTE');
 PERFORM set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000002',true);
 BEGIN PERFORM public.admin_traffic_report(f); RAISE EXCEPTION 'Non-admin read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_set_traffic_account('f9000000-0000-4000-8000-000000000002','test'); RAISE EXCEPTION 'Non-admin write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_traffic_accounts(); RAISE EXCEPTION 'Non-admin accounts allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

 v_id := public.record_browser_view('page','{"p_page_path":"/traffic-audit-user","p_session_id":"traffic-audit-user","hostname":"reklue.com","user_agent":"Mozilla/5.0 Chrome/140.0"}');
 ASSERT v_id=public.record_browser_view('page','{"p_page_path":"/traffic-audit-user","p_session_id":"traffic-audit-user","hostname":"reklue.com","user_agent":"Mozilla/5.0 Chrome/140.0"}'), 'dedup changed';
 PERFORM set_config('request.jwt.claim.sub','',true);
 -- Anonymous calls cannot overwrite another viewer's collection context.
 PERFORM public.record_browser_view('page','{"p_page_path":"/traffic-audit-user","p_session_id":"traffic-audit-user","hostname":"localhost","user_agent":"spoof"}');
 ASSERT (SELECT tracking_hostname='reklue.com' FROM public.page_views WHERE id=v_id);
 PERFORM public.record_browser_view('page','{"p_page_path":"/traffic-audit-bot","p_session_id":"traffic-audit-bot","hostname":"reklue.com","user_agent":"Mozilla/5.0 Mobile Safari/537.36 (compatible; GoogleOther)"}');
 PERFORM public.record_browser_view('page','{"p_page_path":"/traffic-audit-dev","p_session_id":"traffic-audit-dev","hostname":"localhost","user_agent":"Chrome"}');
 PERFORM public.record_browser_view('page','{"p_page_path":"/traffic-audit-auto","p_session_id":"traffic-audit-auto","hostname":"reklue.com","user_agent":"Chrome","automation_hint":true}');
 ASSERT public.record_browser_view('page','{"p_page_path":"/admin/traffic-audit-hidden"}') IS NULL;
 INSERT INTO public.page_views(page_path,session_id) VALUES('/traffic-audit-legacy','traffic-audit-legacy') RETURNING id INTO v_legacy;
 INSERT INTO public.contents(slug,locale,title,is_published) VALUES('traffic-audit-article','en','traffic-audit-article',true) RETURNING id INTO v_content;
 PERFORM public.record_browser_view('content',jsonb_build_object('p_content_id',v_content,'p_session_id','traffic-audit-read','hostname','reklue.com','user_agent','Chrome'));
 PERFORM public.record_traffic_request('{"hostname":"reklue.com","page_path":"/traffic-audit-edge","user_agent":"GoogleOther","country":"US","asn":15169,"verified_bot":true,"response_status":200}');
 -- The report uses an exclusive snapshot end, so fixtures precede that snapshot.
 UPDATE public.page_views SET created_at=now()-interval '1 second' WHERE session_id LIKE 'traffic-audit-%';
 UPDATE public.content_views SET created_at=now()-interval '1 second' WHERE session_id LIKE 'traffic-audit-%';
 UPDATE public.analytics_http_requests SET created_at=now()-interval '1 second' WHERE page_path LIKE '/traffic-audit-%';

 PERFORM set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000001',true);
 q:=public.admin_traffic_report(f);
 ASSERT (q->'summary'->>'total')::integer=7, 'double count or missing records';
 ASSERT (q->'summary'->>'page_views')::integer=5;
 ASSERT (q->'summary'->>'content_views')::integer=1;
 ASSERT (q->'summary'->>'http_requests')::integer=1;
 ASSERT (q->'summary'->>'visitors')::integer=6, 'HTTP requests must not count as browser visitors';
 q:=public.admin_traffic_report(f||'{"classification":"unknown"}'); ASSERT (q->'summary'->>'total')::integer=1;
 q:=public.admin_traffic_report(f||'{"classification":"bot"}'); ASSERT (q->'summary'->>'total')::integer=3;
 q:=public.admin_traffic_report(f||'{"classification":"external"}'); ASSERT (q->'summary'->>'total')::integer=2, 'zero duration does not imply bot';
 PERFORM public.admin_set_traffic_account('f9000000-0000-4000-8000-000000000002','QA account');
 q:=public.admin_traffic_report(f||'{"classification":"internal"}'); ASSERT (q->'summary'->>'total')::integer=2, 'account rule must apply retroactively';
 PERFORM public.admin_annotate_traffic('page',v_legacy,'suspected_bot','Correlated with crawler edge request');
 q:=public.admin_traffic_report(f||'{"classification":"suspected_bot"}'); ASSERT (q->'summary'->>'total')::integer=1;
 PERFORM public.admin_annotate_traffic('page',v_legacy,NULL,NULL);
 q:=public.admin_traffic_report(f||'{"classification":"unknown"}'); ASSERT (q->'summary'->>'total')::integer=1;
 q:=public.admin_traffic_report(f,1,2); ASSERT jsonb_array_length(q->'rows')=2 AND (q->'summary'->>'total')::integer=7;
 q:=public.admin_traffic_report(f||'{"kind":"content"}'); ASSERT (q->'summary'->>'total')::integer=1;
 q:=public.admin_traffic_report(f||'{"environment":"development"}'); ASSERT (q->'summary'->>'total')::integer=1;
 BEGIN PERFORM public.admin_traffic_report(f,0,1001); RAISE EXCEPTION 'Invalid pagination allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Invalid traffic filters' THEN RAISE; END IF; END;
 RAISE NOTICE 'Traffic analysis: authority, privacy grants, dedup, context ownership, bot/internal/unknown classification, retroactive rules, annotations, filtered totals and pagination passed';
END $$;
ROLLBACK;
