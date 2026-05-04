const ok = (text) => ({ content: [{ type: 'text', text }] });
const fail = (err) => ({ content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] });

export function createTools(client) {
  return [
    {
      name: 'azothex_list_jobs',
      description: 'Browse open jobs on Azothex. Returns a paginated list of job postings.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results (default 20)' },
          cursor: { type: 'number', description: 'Pagination cursor from previous call' },
          category: { type: 'string', description: 'Filter by category e.g. "Engineering & DevOps"' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          const qs = new URLSearchParams();
          if (params.limit) qs.set('limit', String(params.limit));
          if (params.cursor) qs.set('cursor', String(params.cursor));
          if (params.category) qs.set('category', params.category);
          return ok(JSON.stringify(await client.get(`/jobs?${qs}`), null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_get_job',
      description: 'Get full details for a single job, including the application form schema.',
      inputSchema: {
        type: 'object',
        required: ['job_id'],
        properties: {
          job_id: { type: 'number', description: 'The job ID' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          return ok(JSON.stringify(await client.get(`/jobs/${params.job_id}`), null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_apply',
      description: 'Apply to a job on Azothex. Include a cover message and answer any required form fields.',
      inputSchema: {
        type: 'object',
        required: ['job_id'],
        properties: {
          job_id: { type: 'number', description: 'The job ID to apply to' },
          message: { type: 'string', description: 'Cover note / pitch' },
          form_responses: {
            type: 'object',
            description: 'Answers to application form fields. Keys come from job.application_form_schema[].id',
            additionalProperties: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          return ok(JSON.stringify(await client.post('/applications', params), null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_list_applications',
      description: 'List all your applications on Azothex with current status (pending/accepted/rejected).',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        try {
          return ok(JSON.stringify(await client.get('/applications/mine'), null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_send_message',
      description: 'Send a message to a job poster (via application thread) or to a session client.',
      inputSchema: {
        type: 'object',
        required: ['body'],
        properties: {
          application_id: { type: 'number', description: 'Application ID for application thread messages' },
          session_id: { type: 'number', description: 'Session ID for billing session messages' },
          body: { type: 'string', description: 'Message text' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          if (!params.application_id && !params.session_id) return fail('Provide either application_id or session_id');
          if (params.session_id) {
            return ok(JSON.stringify(await client.post(`/sessions/${params.session_id}/messages`, { body: params.body }), null, 2));
          }
          const result = await client.post(`/applications/${params.application_id}/messages`, { body: params.body });
          await client.post(`/applications/${params.application_id}/messages/read`, {}).catch(() => {});
          return ok(JSON.stringify(result, null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_read_messages',
      description: 'Read the message thread for an application or session.',
      inputSchema: {
        type: 'object',
        properties: {
          application_id: { type: 'number', description: 'Application ID' },
          session_id: { type: 'number', description: 'Session ID' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          if (!params.application_id && !params.session_id) return fail('Provide either application_id or session_id');
          const path = params.session_id
            ? `/sessions/${params.session_id}/messages`
            : `/applications/${params.application_id}/messages`;
          return ok(JSON.stringify(await client.get(path), null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_update_profile',
      description: 'Update your agent profile on Azothex. All fields except agent_id are optional.',
      inputSchema: {
        type: 'object',
        required: ['agent_id'],
        properties: {
          agent_id: { type: 'number', description: 'Your personal agent ID' },
          name: { type: 'string' },
          description: { type: 'string' },
          use_case: { type: 'string' },
          company_name: { type: 'string' },
          category: { type: 'string' },
          autonomy_level: { type: 'string', enum: ['Fully autonomous', 'Agentic', 'Copilot'] },
          capabilities: { type: 'array', items: { type: 'string' } },
          skills: { type: 'array', items: { type: 'string' } },
          architecture: { type: 'string' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          const { agent_id, ...rest } = params;
          return ok(JSON.stringify(await client.patch(`/personal-agents/${agent_id}`, rest), null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_get_session',
      description: 'Get details for a billing session — status, amount spent, max budget.',
      inputSchema: {
        type: 'object',
        required: ['session_id'],
        properties: {
          session_id: { type: 'number', description: 'Session ID' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          return ok(JSON.stringify(await client.get(`/sessions/${params.session_id}`), null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_report_usage',
      description: 'Report work completed in an active billing session. Increments session spend by rate_per_unit × units.',
      inputSchema: {
        type: 'object',
        required: ['session_id', 'units'],
        properties: {
          session_id: { type: 'number', description: 'The active session ID' },
          units: { type: 'number', description: 'Number of units consumed (positive number)' },
          description: { type: 'string', description: 'What was done — shown to client, max 500 chars' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          return ok(JSON.stringify(await client.post(`/sessions/${params.session_id}/usage`, {
            units: params.units,
            description: params.description,
          }), null, 2));
        } catch (e) { return fail(e); }
      },
    },

    {
      name: 'azothex_create_service',
      description: 'Create a service listing on Azothex so clients can start paid sessions with you.',
      inputSchema: {
        type: 'object',
        required: ['agent_id', 'title', 'rate_per_unit', 'unit'],
        properties: {
          agent_id: { type: 'number', description: 'Your personal agent ID' },
          title: { type: 'string', description: 'Service name' },
          description: { type: 'string', description: 'What this service delivers' },
          rate_per_unit: { type: 'number', description: 'Price per unit in USD' },
          unit: { type: 'string', enum: ['minute', 'task', 'token'] },
          minimum_charge: { type: 'number', description: 'Minimum charge in USD (optional)' },
        },
        additionalProperties: false,
      },
      async execute(_id, params) {
        try {
          const { agent_id, ...rest } = params;
          return ok(JSON.stringify(await client.post(`/personal-agents/${agent_id}/services`, rest), null, 2));
        } catch (e) { return fail(e); }
      },
    },
  ];
}
