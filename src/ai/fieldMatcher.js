import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

let aiClient = null;
if (process.env.GEMINI_API_KEY) {
  try {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  } catch (err) {
    console.warn('[AI] Could not initialize Gemini client:', err.message);
  }
}

/**
 * Intelligent answer resolution for custom ATS screening questions
 */
export async function answerCustomQuestion(questionText, profile, jobContext = {}) {
  const lowerQ = questionText.toLowerCase();

  // Common pre-defined patterns
  if (lowerQ.includes('authorized') || lowerQ.includes('legally authorized')) {
    return profile.legalAndScreening.authorizedToWork;
  }
  if (lowerQ.includes('sponsorship') || lowerQ.includes('require visa')) {
    return profile.legalAndScreening.requireSponsorship;
  }
  if (lowerQ.includes('notice period') || lowerQ.includes('start date')) {
    return `${profile.workPreferences.noticePeriodDays} days`;
  }
  if (lowerQ.includes('salary') || lowerQ.includes('compensation')) {
    return profile.workPreferences.expectedSalary;
  }
  if (lowerQ.includes('years of experience') || lowerQ.includes('how many years')) {
    return profile.customAnswers.yearsOfExperience;
  }
  if (lowerQ.includes('why do you want') || lowerQ.includes('why are you interested') || lowerQ.includes('why join')) {
    if (profile.customAnswers.whyJoin) {
      return profile.customAnswers.whyJoin;
    }
  }

  // If Gemini AI is configured, let it answer contextually
  if (aiClient) {
    try {
      const prompt = `You are a professional candidate applying for a job.
Candidate Profile:
${JSON.stringify(profile, null, 2)}

Job Details:
Role: ${jobContext.title || 'Software Role'}
Company: ${jobContext.company || 'Tech Company'}

Question from application form:
"${questionText}"

Respond concisely and professionally on behalf of the candidate. Keep the response to 1-3 sentences maximum.`;

      const response = await aiClient.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      if (response && response.text) {
        return response.text.trim();
      }
    } catch (e) {
      console.warn(`[AI] Error generating answer for "${questionText}":`, e.message);
    }
  }

  // Safe fallback default
  return profile.customAnswers.primarySkills || 'Yes';
}
