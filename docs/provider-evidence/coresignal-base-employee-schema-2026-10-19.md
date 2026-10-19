# Coresignal Base Employee schema and Preview pagination evidence

Date: 2026-10-19 (Asia/Kolkata)

Sources inspected read-only, without an API key or provider-data request:

- Coresignal public CDAPI OpenAPI document, `GET /cdapi/openapi.json`
- Coresignal Search Preview documentation
- Vendor workbook `alumni_platform_questions_and_answers (1).xlsx`, sheet `Answers`

The public OpenAPI response model identifies the Base Employee education value as `education.program` and the Base Employee employment designation as `experience.title`. It includes `experience.is_current` and `experience.deleted`; it does not define a Base Employee management-level or seniority field. Corporate Network therefore uses conservative title phrases only as provider-side narrowing and reclassifies the returned current title locally.

The Base Employee ES-DSL Preview operation `POST /v2/employee_base/search/es_dsl/preview` documents a `page` query parameter with inclusive bounds 1–50. Page 1 is the default. The general Search Preview documentation says each additional page is a separate credit-consuming request. The vendor workbook states that Preview returns up to 20 records per page and charges 20 search credits per page.

No provider-data endpoint was called while recording this evidence. No API credential or provider payload is stored here.
