import type { NextApiRequest, NextApiResponse } from "next";

const SWAGGER_HTML = /*html*/`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Lapse API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.0/swagger-ui.css" />
  <style>
    body { margin: 0; background: #f5f7fb; }
    #swagger-ui { max-width: 1100px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.0/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/rest/openapi",
      dom_id: "#swagger-ui",
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: "none",
      persistAuthorization: true
    });
  </script>
</body>
</html>
`.trim();

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET")
    return res.status(405).send("Method not allowed");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(SWAGGER_HTML);
}
