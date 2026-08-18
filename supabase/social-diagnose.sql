-- ONE-SHOT DIAGNOSIS · run this whole thing as a single query
select * from (
  select 1 as ord, 'queue: '||status as item,
         count(*)::text as info, max(due_at)::text as detail
  from public.social_queue group by status
  union all
  select 2, 'failed: '||slug, coalesce(error,'(no error text)'), due_at::text
  from public.social_queue where status = 'failed' limit 10
) a
union all
select 3, 'http '||coalesce(r.status_code::text, 'NO-RESPONSE'),
       left(coalesce(r.content, r.error_msg, ''), 200), r.created::text
from (select * from net._http_response order by created desc limit 8) r
order by 1, 4 desc;
