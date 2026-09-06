-- Compatibility release metadata for the extracted first event pack.
-- New packs are registered through register_event_pack_release instead of new migrations.

with source_event as (
  select id from public.events where slug='halloween-2026' limit 1
), questions as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'question',q.question,
    'answers',case when q.answers='{}'::jsonb then jsonb_build_object('a',q.answer_a,'b',q.answer_b,'c',q.answer_c) else q.answers end,
    'correctAnswer',q.correct_answer,
    'difficulty',q.difficulty
  ) order by q.created_at),'[]'::jsonb) value
  from public.minion_questions q join source_event e on e.id=q.event_id where q.enabled
), enriched as (
  select r.pack_key,r.version,
    jsonb_set(
      r.manifest || jsonb_build_object(
        'description','Halloween-Eventpack für die PXB Community Event Engine.',
        'engine',jsonb_build_object('minimumVersion','1.0.0'),
        'theme','{"className":"theme-halloween-2026","colors":{"primary":"#f28a2e","secondary":"#7f75e9","accent":"#c878f2","surface":"#120d18","text":"#fff4dc"},"labels":{"event":"KÜRBISKÖNIG EVENT","boss":"GLOBALER BOSS","prelaunch":"Event startet bald","paused":"Das Event pausiert"}}'::jsonb,
        'integrations','{"discord":{"senderName":"Kürbiskönig Event","footer":"Kürbiskönig Community Boss Event","defaultLiveDescription":"Die Community stellt sich dem Kürbiskönig.","color":16347926}}'::jsonb,
        'website','{"headline":"Gemeinsam gegen den Kürbiskönig","shortDescription":"Mehrere Communities, ein gemeinsamer Raidboss.","callToAction":"Teilnehmende Streams entdecken"}'::jsonb
      ),
      '{minions}',
      coalesce((select jsonb_agg(
        case when item#>>'{runtime,type}'='question-pool'
          then jsonb_set(item,'{runtime,questions}',q.value,true)
          else item end
      ) from jsonb_array_elements(r.manifest->'minions') item cross join questions q),'[]'::jsonb),
      true
    ) manifest
  from public.event_pack_releases r
  where r.pack_key='halloween-2026' and r.version='1.0.0'
)
update public.event_pack_releases r set manifest=e.manifest,updated_at=now()
from enriched e where r.pack_key=e.pack_key and r.version=e.version;

update public.events e set presentation=r.manifest->'theme',updated_at=now()
from public.event_pack_releases r
where e.pack_key=r.pack_key and e.pack_version=r.version and r.pack_key='halloween-2026' and r.version='1.0.0';
