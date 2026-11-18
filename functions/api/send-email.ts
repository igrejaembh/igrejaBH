interface Env {
  RESEND_API_KEY?: string
  RESEND_FROM_EMAIL?: string
}

interface PagesContext {
  request: Request
  env: Env
}

interface SendEmailPayload {
  to?: string | string[]
  subject?: string
  html?: string
  text?: string
  from?: string
  reply_to?: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  })
}

export function onRequestOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  try {
    const resendApiKey = context.env.RESEND_API_KEY
    const defaultFrom =
      context.env.RESEND_FROM_EMAIL ||
      "Igreja em Belo Horizonte <notificacoes@igrejaembh.com.br>"

    if (!resendApiKey) {
      return jsonResponse(
        { error: "RESEND_API_KEY não configurada no ambiente do Cloudflare Pages." },
        500
      )
    }

    const body = (await context.request.json()) as SendEmailPayload
    const { to, subject, html, text, from, reply_to, cc, bcc } = body || {}

    if (!to || !subject || (!html && !text)) {
      return jsonResponse(
        {
          error: "Campos obrigatórios ausentes: 'to', 'subject' e ('html' ou 'text').",
        },
        400
      )
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from || defaultFrom,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        reply_to,
        cc,
        bcc,
      }),
    })

    const data = (await resendRes.json()) as Record<string, unknown>

    if (!resendRes.ok) {
      console.error("Resend API Error (Cloudflare Pages Function):", data)
      return jsonResponse(
        { error: "Erro no disparo pelo provedor Resend", details: data },
        resendRes.status
      )
    }

    return jsonResponse({ success: true, data }, 200)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erro interno"
    console.error("Erro interno em /api/send-email (Cloudflare Pages):", message)
    return jsonResponse({ error: "Erro interno ao enviar e-mail", message }, 500)
  }
}
