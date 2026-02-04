// Simple Gemini Broker Assistant Cloud Function (CommonJS, ESLint-friendly)

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { VertexAI } = require("@google-cloud/vertexai");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const projectId = process.env.GCLOUD_PROJECT; // set by Firebase
const location = "us-central1";

const vertexAI = new VertexAI({
  project: projectId,
  location: location,
});

const model = vertexAI.getGenerativeModel({
  model: "gemini-1.5-pro",
});

exports.askBrokerAssistant = functions
  .region("us-central1")
  .https.onCall(async (data, context) => {
    // Require authentication
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "You must be signed in to use the broker assistant."
      );
    }

    // Safely read inputs (no optional chaining)
    let question = "";
    if (data && typeof data.question === "string") {
      question = data.question.trim();
    }

    let category = "general";
    if (data && typeof data.category === "string") {
      category = data.category.trim();
    }

    if (!question) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Question is required."
      );
    }

    const agentUid = context.auth.uid;
    const agentEmail =
      (context.auth.token && context.auth.token.email) || null;

    // Log request in Firestore
    const docRef = await db.collection("agentRequests").add({
      agentUid: agentUid,
      agentEmail: agentEmail,
      question: question,
      category: category,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const systemPrompt =
      "You are the AI assistant for Equity Real Estate / Equity New Mexico. " +
      "You support licensed real estate brokers in New Mexico with questions " +
      "about contracts, disclosures, timelines, negotiation strategy, and " +
      "professional communication. You do not give legal or tax advice. " +
      "If something is risky or unclear, tell the broker to confirm with " +
      "the Qualifying Broker before acting.\n\n";

    const userPrompt =
      "Agent: " + (agentEmail || "unknown") + "\n" +
      "Category: " + category + "\n" +
      "Question:\n" + question + "\n\n" +
      "Provide:\n" +
      "1) A concise, practical answer.\n" +
      "2) Bullet-point steps or options.\n" +
      "3) A copy-paste script the broker can send to a client.\n" +
      "4) A note when Qualifying Broker review is recommended.\n";

    // Call Gemini
    const genResult = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt + userPrompt }],
        },
      ],
    });

    let answer =
      "I was unable to generate an answer. Please try again or contact your Qualifying Broker.";

    try {
      if (
        genResult &&
        genResult.response &&
        genResult.response.candidates &&
        genResult.response.candidates[0] &&
        genResult.response.candidates[0].content &&
        genResult.response.candidates[0].content.parts &&
        genResult.response.candidates[0].content.parts.length > 0
      ) {
        answer = genResult.response.candidates[0].content.parts
          .map(function (p) {
            return p.text || "";
          })
          .join("");
      }
    } catch (e) {
      // fall back to default answer
    }

    // Save answer in Firestore
    await docRef.update({
      answer: answer,
      status: "answered",
      answeredAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { answer: answer };
  });
