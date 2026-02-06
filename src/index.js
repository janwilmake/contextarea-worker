export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// POST /paste — store content, return URL
		if (url.pathname === '/paste' && request.method === 'POST') {
			return handlePaste(request, env, url, corsHeaders);
		}

		// GET /paste/:id — retrieve stored paste
		if (url.pathname.startsWith('/paste/') && request.method === 'GET') {
			return handleGetPaste(url, env, corsHeaders);
		}

		// GET /context?url=... — fetch & analyze a URL
		if (url.pathname === '/context' && request.method === 'GET') {
			return handleContext(url, corsHeaders);
		}

		// Everything else: static assets (index.html, contextarea.js)
		return env.ASSETS.fetch(request);
	},
};

async function handlePaste(request, env, url, corsHeaders) {
	if (!env.PASTES) {
		return new Response('KV not configured — see wrangler.toml', {
			status: 503,
			headers: corsHeaders,
		});
	}

	const id = crypto.randomUUID().slice(0, 8);
	const content = await request.text();
	const contentType = request.headers.get('Content-Type') || 'text/plain';

	await env.PASTES.put(id, content, {
		metadata: { contentType },
		expirationTtl: 86400 * 30,
	});

	const pasteUrl = `${url.origin}/paste/${id}`;
	return new Response(pasteUrl, {
		headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
	});
}

async function handleGetPaste(url, env, corsHeaders) {
	if (!env.PASTES) {
		return new Response('KV not configured', { status: 503, headers: corsHeaders });
	}

	const id = url.pathname.slice('/paste/'.length);
	const { value, metadata } = await env.PASTES.getWithMetadata(id);

	if (!value) {
		return new Response('Not found', { status: 404, headers: corsHeaders });
	}

	return new Response(value, {
		headers: {
			...corsHeaders,
			'Content-Type': metadata?.contentType || 'text/plain',
		},
	});
}

async function handleContext(url, corsHeaders) {
	const targetUrl = url.searchParams.get('url');
	if (!targetUrl) {
		return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
			status: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	try {
		const response = await fetch(targetUrl, {
			headers: { 'User-Agent': 'ContextArea/1.0' },
			redirect: 'follow',
		});

		const contentType = response.headers.get('Content-Type') || '';
		const text = await response.text();

		let title = targetUrl;
		let description = '';
		let type = 'unknown';

		if (contentType.includes('text/html')) {
			return new Response(JSON.stringify({ error: 'HTML pages are not supported as context' }), {
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		} else if (contentType.includes('application/json')) {
			type = 'json';
		} else if (contentType.includes('text/')) {
			type = 'text';
		} else {
			type = contentType.split('/')[1] || 'binary';
		}

		const tokens = Math.ceil(text.length / 4);

		return new Response(JSON.stringify({ title, type, tokens, description, content: text }), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	} catch (error) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}
}
