const { createOpencodeClient } = require("@opencode-ai/sdk")

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
})

const main = async () => {
  const projects = await client.project.list()
  console.log("projects", projects)

  const sessions = await client.session.list()
  console.log("sessions", sessions)

//   if (sessions.length > 0) {
//     const sessionId = sessions[0].id
//     const messages = await client.session.messages(sessionId)
//     console.log("messages", messages)
//   }
}

main().catch((err) => {
  console.error(err)
})