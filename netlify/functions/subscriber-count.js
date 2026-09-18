// Esta función corre en el servidor de Netlify, nunca en el navegador del
// visitante — por eso es el único lugar seguro para usar tu clave de API
// de Buttondown. La clave se lee de una variable de entorno (la configuras
// en Netlify, nunca aquí en el código).
//
// Configúrala en: Netlify → Site configuration → Environment variables
//   Key:   BUTTONDOWN_API_KEY
//   Value: (la generas en Buttondown → Settings → Programming → API keys)

exports.handler = async function () {
  const apiKey = process.env.BUTTONDOWN_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: null, error: "BUTTONDOWN_API_KEY no configurada todavía" })
    };
  }

  try {
    const res = await fetch("https://api.buttondown.com/v1/subscribers?type=regular", {
      headers: { Authorization: `Token ${apiKey}` }
    });
    const data = await res.json();
    const count = typeof data.count === "number" ? data.count : (data.results ? data.results.length : 0);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      body: JSON.stringify({ count })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: null, error: "No se pudo consultar Buttondown" })
    };
  }
};
