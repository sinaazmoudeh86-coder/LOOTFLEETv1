-- SOCIAL QUEUE HEALTH CHECK · paste into Supabase SQL editor, run all
-- 1) Calendar state: how many left, when the next one fires
select status, count(*) as rows, min(due_at) as earliest, max(due_at) as latest
from public.social_queue group by status order by status;

-- 2) Next 5 upcoming posts (should start today/tomorrow, 2 per day)
select slug, due_at from public.social_queue
where status = 'queued' order by due_at limit 5;

-- 3) Last 5 posted (posted_at should reach today)
select slug, due_at, posted_at from public.social_queue
where status = 'posted' order by posted_at desc limit 5;

-- 4) Any failures? ('claimed — in flight' stuck rows are crashes mid-post)
select slug, due_at, error from public.social_queue
where status = 'failed' order by due_at;

-- 5) Cron heartbeat: last 10 runs of the social-post job (should be every 15 min)
select r.start_time, r.status, left(r.return_message, 120) as msg
from cron.job_run_details r join cron.job j on j.jobid = r.jobid
where j.jobname = 'social-post' order by r.start_time desc limit 10;

-- FIX: re-queue failed rows (safe — already-posted channels are skipped on retry)
-- update public.social_queue set status = 'queued', error = null where status = 'failed';
