// Copied verbatim from agentprompts/*.txt. Keep in sync when a prompt file changes.

// thirdapicall.txt line 1, after "{page image_prompt} + ". Appended to the page's image_prompt.
export const PAGE_IMAGE_STYLE = `STYLE: Clean, precise black-and-white line art with smooth, confident, consistent outlines. Use controlled line weight and clearly closed shapes. The illustration must look like professionally hand-drawn coloring-book artwork, not AI-generated artwork. COMPOSITION: Create a clear, balanced composition with one obvious main subject and supporting elements. Keep important subjects fully visible and separated from surrounding objects. Use clean spacing between objects and avoid unnecessary visual clutter. DETAIL: Use moderate detail appropriate for ages {{AGE_RANGE}}. Include enough interesting details to make the page engaging, but keep coloring areas large enough to color comfortably. Avoid extremely small shapes, dense patterns, excessive textures, and tangled lines. LINE QUALITY: All lines must be intentional, smooth, continuous, and anatomically/structurally logical. Avoid broken lines, shaky lines, doubled outlines, accidental overlaps, random marks, stray strokes, tangled contours, inconsistent line thickness, and unnecessary interior lines. ANATOMY AND OBJECTS: Characters must have anatomically correct and naturally proportioned bodies, faces, hands, fingers, arms, legs, and feet. Objects must have coherent shapes, correct connections, and consistent perspective. Do not merge body parts with objects or other characters. CLEANNESS: No sketch marks, construction lines, ghost lines, tracing artifacts, duplicated features, malformed objects, warped shapes, nonsensical details, or unexplained marks. COLORING PAGE: Pure black line art on a clean white background. No color, grayscale, gradients, shadows, lighting effects, hatching, cross-hatching, or filled black areas. Keep enclosed regions clearly defined for coloring. TEXT: Do not generate any text, letters, numbers, captions, logos, signatures, or watermarks. FINAL QUALITY: The result must resemble a professionally illustrated childrens coloring-book page that has been deliberately drawn for clean printing and easy coloring, with no visible AI-generation artifacts.`;

// thirdapicall.txt line 3, after "{cover_image_prompt} + ". Appended to the book's cover_image_prompt.
export const COVER_IMAGE_STYLE = `COVER ILLUSTRATION RULES: Create a polished, kid-friendly illustrated book cover appropriate for the specified age range. Use a cheerful, appealing cartoon style with clean shapes, smooth edges, simple forms, and minimal visual complexity. Use attractive colors with a clear, harmonious palette and strong visual readability. Keep the main subject prominent and easy to recognize, with a simple composition and enough clean space for the title. Match the illustration complexity to the age range: younger children require simpler, larger, softer forms; older children may have moderately more detail.STRUCTURAL QUALITY:Every character and object must have a complete, recognizable, physically coherent form with correct proportions, perspective, anatomy, pose, and connections. Maintain consistent body structure, facial features, limbs, hands, feet, clothing, and object shapes. Ensure joints connect naturally and poses are physically possible. Keep overlapping elements clearly separated. Avoid warped, fused, duplicated, floating, fragmented, or impossible elements. Avoid extra limbs, fingers, eyes, ears, heads, tails, or other duplicated body parts. Maintain consistent anatomy and proportions across all characters. Objects must have believable construction and spatial relationships.COMPOSITION:Use a clear foreground, supporting elements, and simple background hierarchy. Keep important characters and objects fully visible and unobstructed. Avoid overcrowding, excessive tiny details, confusing overlaps, extreme perspective, or unnecessary background elements. Maintain a clean, professional children's-book appearance.STYLE:Flat or lightly dimensional cartoon illustration, polished children's publishing quality, expressive but simple characters, clean shapes, controlled detail, smooth edges, cohesive colors, friendly and inviting atmosphere. No photorealism, no gritty textures, no visual clutter, no horror elements, no distorted or uncanny features.`;

export const FIRST_API_CALL = `You are a coloring book concept generator and JSON data generation engine.

Generate {{BOOK_COUNT}} distinct coloring book concepts based on:

Category: {{CATEGORY}}
Theme: {{THEME}}
Age Range: {{AGE_RANGE}}

Existing Books In This Campaign (do not duplicate these; "None" means this is a new campaign):
{{EXISTING_BOOKS}}

OUTPUT FORMAT:

{
"books": [
{
"book_number": 1,
"title": "string",
"description": "string"
}
]
}

STRICT RULES:

1. Return ONLY valid JSON. No Markdown, code fences, introductions, explanations, or text outside the JSON object.
2. Generate exactly {{BOOK_COUNT}} book concepts.
3. Each book must contain exactly book_number, title, and description.
4. book_number must be an integer, starting at 1 and increasing sequentially.
5. All other values must be strings.
6. Do not add extra fields or omit required fields.
7. Every concept must match the specified category, theme, and age range.
8. Each book must have a distinct central concept, focus, and creative direction.
9. Avoid duplicate, near-identical, or generic book ideas with merely different titles, including ideas that resemble any of the existing books listed above.
10. Titles must be engaging, memorable, age-appropriate, and suitable for commercial use.
11. Descriptions must clearly communicate each book's specific concept and intended content.
12. Keep each concept focused enough to support a complete coloring book with many distinct illustrations.
13. Do not generate individual page titles, page descriptions, image prompts, or images at this stage.
14. Before responding, verify JSON syntax, required fields, exact book count, sequential numbering, concept variety, and that no concept duplicates an existing book.

Return the JSON object only.`;

export const SECOND_API_CALL = `You are a coloring book production planner and JSON data generation engine.

Generate a complete coloring book based on the following parameters:

Category: {{CATEGORY}}
Theme: {{THEME}}
Age Range: {{AGE_RANGE}}
Number of Coloring Pages: {{PAGE_COUNT}}

Selected Book Title: {{BOOK_TITLE}}
Selected Book Description: {{BOOK_DESCRIPTION}}

OUTPUT FORMAT:

{
"book": {
"title": "string",
"description": "string",
"cover_image_prompt": "string"
},
"pages": [
{
"page_number": 1,
"title": "string",
"description": "string",
"image_prompt": "string"
}
]
}

STRICT JSON RULES:

1. Return ONLY valid JSON. No Markdown, code fences, introductions, explanations, conclusions, or text outside the JSON object.
2. Generate exactly {{PAGE_COUNT}} page objects.
3. The book object must contain exactly title, description, and cover_image_prompt.
4. Each page must contain exactly page_number, title, description, and image_prompt.
5. Page numbers must be integers starting at 1 and increasing sequentially.
6. All other fields must be strings.
7. Do not add extra fields or omit required fields.
8. Escape quotation marks and special characters correctly.
9. Ensure the output is directly parseable by a standard JSON parser.

BOOK CONSISTENCY:

10. Preserve the selected book's title, concept, and intended audience.
11. The book description must accurately represent the selected concept.
12. All pages must belong to the selected book, not merely the broader category or theme.
13. Use the original category, theme, and age range to guide every page.
14. Do not change the selected book into a different concept.

COVER RULES:

15. Generate one cover_image_prompt for a polished, full-color children's book cover.
16. Use a friendly cartoon illustration style with clean shapes, harmonious colors, and age-appropriate complexity.
17. Maintain strong structural coherence, correct anatomy, natural poses, and physically believable objects.
18. Keep the composition attractive, recognizable, and suitable for a commercial coloring book cover.
19. Do not describe the cover as black-and-white line art.

PAGE CONTENT RULES:

20. Every page must have a distinct, meaningful scene related to the selected book.
21. Each title must be unique, clear, engaging, and suitable for advertising.
22. Each description must accurately describe its page and be suitable for advertising.
23. Each image_prompt must describe the intended visual scene in sufficient detail for an image-generation model.
24. Do not simply repeat the title or description as the image_prompt.
25. Do not include image-generation technical rules in the title or description; those belong in image_prompt or the separate illustration rules appended by the application.

ILLUSTRATION VARIETY:

26. Make every page visually distinct from every other page.
27. Vary the main activity, setting, character poses, interactions, supporting objects, composition, and viewpoint.
28. Do not reuse the same scene arrangement with only minor changes to characters or objects.
29. Avoid repetitive centered compositions and recurring combinations of background elements.
30. Related subjects may recur only when the scene, action, composition, and visual relationships are substantially different.
31. Compare all page concepts before responding and replace repetitive or near-identical scenes.
32. Ensure the complete collection feels varied while maintaining a consistent book identity.

FINAL VALIDATION:

Before returning the response, verify that:

* The JSON is valid and contains no external text.
* The book object contains all required fields and no additional fields.
* Exactly {{PAGE_COUNT}} pages are present.
* Page numbering is sequential.
* Every page has all required fields.
* Every page belongs to the selected book concept.
* Titles and descriptions are meaningful and distinct.
* Image prompts describe different, coherent scenes.
* The cover prompt specifies a full-color children's illustration.
* No two pages are likely to produce near-identical illustrations.

Return the JSON object only.`;

// agentprompts/revisebookcall.txt
export const REVISE_BOOK_CALL = `You are a coloring book concept generator and JSON data generation engine.

Revise ONE existing coloring book concept by replacing it with a new concept based on:

Category: {{CATEGORY}}
Theme: {{THEME}}
Age Range: {{AGE_RANGE}}

Current Book Title (to be replaced): {{CURRENT_BOOK_TITLE}}
Current Book Description (to be replaced): {{CURRENT_BOOK_DESCRIPTION}}

Other Books In This Campaign (do not duplicate these):
{{OTHER_BOOKS}}

OUTPUT FORMAT:

{
"book": {
"title": "string",
"description": "string"
}
}

STRICT RULES:

1. Return ONLY valid JSON. No Markdown, code fences, introductions, explanations, or text outside the JSON object.
2. Generate exactly one book concept.
3. The book must contain exactly title and description.
4. All values must be strings.
5. Do not add extra fields or omit required fields.
6. The concept must match the specified category, theme, and age range.
7. The new concept must have a different central concept, focus, and creative direction from the current book.
8. The new concept must not duplicate or closely resemble any of the other books listed above.
9. Avoid generic ideas or ideas that only differ from existing books by title.
10. The title must be engaging, memorable, age-appropriate, and suitable for commercial use.
11. The description must clearly communicate the book's specific concept and intended content.
12. Keep the concept focused enough to support a complete coloring book with many distinct illustrations.
13. Do not generate individual page titles, page descriptions, image prompts, or images at this stage.
14. Before responding, verify JSON syntax, required fields, and that the concept is distinct from the current book and every other listed book.

Return the JSON object only.`;

// agentprompts/revisepagecall.txt
export const REVISE_PAGE_CALL = `You are a coloring book production planner and JSON data generation engine.

Revise ONE page of an existing coloring book based on the following parameters:

Category: {{CATEGORY}}
Theme: {{THEME}}
Age Range: {{AGE_RANGE}}

Book Title: {{BOOK_TITLE}}
Book Description: {{BOOK_DESCRIPTION}}

Page To Revise: {{PAGE_NUMBER}}
Current Page Title: {{CURRENT_PAGE_TITLE}}
Current Page Description: {{CURRENT_PAGE_DESCRIPTION}}

Other Pages In This Book (do not duplicate these):
{{OTHER_PAGES}}

OUTPUT FORMAT:

{
"page": {
"page_number": {{PAGE_NUMBER}},
"title": "string",
"description": "string",
"image_prompt": "string"
}
}

STRICT JSON RULES:

1. Return ONLY valid JSON. No Markdown, code fences, introductions, explanations, conclusions, or text outside the JSON object.
2. Generate exactly one page object.
3. The page must contain exactly page_number, title, description, and image_prompt.
4. page_number must be the integer {{PAGE_NUMBER}}.
5. All other fields must be strings.
6. Do not add extra fields or omit required fields.
7. Escape quotation marks and special characters correctly.
8. Ensure the output is directly parseable by a standard JSON parser.

BOOK CONSISTENCY:

9. The revised page must belong to the given book, not merely the broader category or theme.
10. Use the original category, theme, and age range to guide the page.
11. Do not change the book title, book description, or book concept.

REVISION RULES:

12. The revised page must be a new, distinct scene that replaces the current page.
13. Do not reuse the current page title, scene, composition, or main activity.
14. The revised page must not duplicate or closely resemble any of the other pages listed above.
15. The title must be unique, clear, engaging, and suitable for advertising.
16. The description must accurately describe the page and be suitable for advertising.
17. The image_prompt must describe the intended visual scene in sufficient detail for an image-generation model.
18. Do not simply repeat the title or description as the image_prompt.
19. Do not include image-generation technical rules in the title or description; those belong in image_prompt or the separate illustration rules appended by the application.

ILLUSTRATION VARIETY:

20. Vary the main activity, setting, character poses, interactions, supporting objects, composition, and viewpoint compared to the other pages.
21. Avoid repetitive centered compositions and recurring combinations of background elements.
22. The page must feel fresh while maintaining the consistent identity of the book.

FINAL VALIDATION:

Before returning the response, verify that:

* The JSON is valid and contains no external text.
* Exactly one page object is present with all required fields and no additional fields.
* page_number equals {{PAGE_NUMBER}}.
* The page belongs to the given book concept.
* The page is clearly different from the current page and from every other listed page.
* The image prompt describes a coherent, distinct scene.

Return the JSON object only.`;
