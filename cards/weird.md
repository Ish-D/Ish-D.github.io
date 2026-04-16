---
name: Why Make a Page This Weird?
width: 320
height: 400
progressBar: true
wordCount: true
readTime: true
tags: [essays, ideas], [design, meta]
date: 01-30-2026
---

# Why Make a Page this Weird?
[[tags]]
[[date]]    
[[summary]]{A glimpse into the inspiration behind this website and my goals for it. }
[[toc]]
---
## Purpose
[[quote([[cite(https://gwern.net/about#the-content)]]{Gwern Branwen})]]
{
I believe that someone who has been well-educated will think of something worth writing at least once a week; to a surprising extent, this has been true.
}
[[drop(I)]]n my time creating this site, I've found the above Gwern quote incredibly true. There's always so much going through everyone's head; at least some of those thoughts are bound to be worth exploring further. When you begin framing sporadic thoughts as 'potential ideas to write about' rather than 'superfluous nonsense,' you're much more inclined to take the time to medidate on them. 
### [[anchor(mind)]]{The Mind}
[[tab]]Writing is one of the best (or only?) ways to explore an idea fully; it pins your scattered ideas down and forces you to confront them. I have been telling myself to write more for years, always waiting for the perfect medium. A few years ago I read a tweet that I've thought a lot about:  'The fact that you get a nice block of text to share after writing an essay is just an additional benefit; the main value is that you have to organize your mind while writing'. My goal for this site is to organize my mind and have a formal continuation of a series of one-page essays I wrote around late 2023 to explore some long-lingering ideas. I wrote a fake eulogy for a friend, some personal retrospectives, and one on why I dislike the idea of rewatching/rereading things and my own related rituals. 
[[break]]
### The Metal
[[tab]]Expect the most frequent posts to be dedicated to technical topics, software engineering, GPUs, graphics, etc.  Topics I love and that live in my mind; this page was created as an outlet for them as much as a way to set straight whatever is on my mind.  I have 2-3 projects in the rotation at a time to not get burnt out of any single project, actively working on one while keeping the others in context.  Most of these are meant to be a way for me to learn more about things I am interested in. Like right now, I want to learn about the internals of LLMs and their training/inference processes which are both interesting to me and increasingly relevant to the work I do. 
[[break]]
### The Mediums
[[tab]] Then there is all of the art in my life. Film frames and book quotes, the photography, the collected artifacts. Where the machine wants to strip away time, optimize the execution and bleed out the milliseconds, the mediums demand friction. You have to advance the film, you have to sit with the text, you have to see the negative space. This is where I find meaning in those moments. Dissecting why a certain slant of light or a scene stays lodged in my head and shifts the way I walk through the city. This is my place to lay those fragments out and share whatever meaning I can piece out of them.

## Inspiration

[[quote([[cite(https://bsky.app/profile/freya.bsky.social/post/3lcwyvolfjk2u)]]{Freya Holmér})]]
{
it's kinda sad that digital work is so hidden
[[break]]
like there's no messy study room or bookshelves full of works you've read or letters from people and gizmos and widgets you've built or stacks of drawings and diagrams
[[break]]
it's all just, hidden in folders, already lost in space, and eventually lost to time
}
[[break]]

[[tab]]Amidst notions of of wanting to write, I thought about how much the medium shapes the expressivity of a work. I knew I needed a unique space to share with the world. Around December 2024, I started collecting references for the vibe I wanted to convey.  They were over the place, the kind of collection that could only be coherent to the person who gathered them; tweets, blog posts, pictures from [[note(right, orient:horizontal)]]{[[anchor(house-of-leaves)]]{novels}}{I think the [[cite(https://en.wikipedia.org/wiki/House_of_Leaves)]]{House of Leaves} [[jump(house-of-leaves)]]{ influence} here will be pretty apparent. Though I really wonder how much I'll actually end up making use of the whole story-in-a-margin thing.} and [[jump(EnM)]]{textbooks}, some scattered notes. The quote above was central one to my vision of the design. I latched onto the idea that the site could feel physical; disordered, browseable, like something you'd find on a desk rather than a server. 
[[break]]
[[tab]]I tend to wander in conversation and writing, so why not extend that with the House of Leaves style story-in-a-story-in-a-margin? Because the atomic unit of the site is an individual card, it's easy to interject tangential blocks mid-thought without challenging the coherency of the main structure. Most websites reward depth-first reading, you open anything of interest in a new tab and work through them. I wanted to reward going breadth first, let you follow a tangent before eventually returning to the thread. I can't force it, but if the cards are good,  you'll find yourself down the rabbit hole.
[[break]]
[[tab]] Gwern's website is probably the clearest influence on this one. His feels loose and informal, but with rigor underneath, backed by experiments and sources. There's a category of writing that reads more like academic reports, his experiments and other blogs like this one on the [[cite(https://investment.binhph.am/#/analysis/ai-inference)]]{flow of capital through the AI inference supply chain} or this one on [[cite(https://ciechanow.ski/cameras-and-lenses/)]]{the mechanics behind cameras and lenses} that are endlessly fascinating to me. They are incredibly labored, but none of them are strictly about programming. They lie at the conjunction of fields, pulling from physics, engineering, statistics, and design all at once. They set the standard that I am aiming for..
[[break]]
[[tab]] One of the primary inspirations for me was always [[cite(https://thenumb.at/)]]{Max Slater}. His posts are short, dense, and interactive in a way that lets your brain fully grasp the idea by the time you're done. The visualizations in his and Bartosz Ciechanowski's posts do something  text can't, they let you see the concepts in motion, see the vectors in the field warp before you understand it. Thus, embedding graphics, functions, graphs, etc., into the cards became non-negotiable. 
[[break]]
[[tab]] At the same time, there is something irreplaceable about the look of good old print media, the weight of it and the design that comes with the constraints of the columns.  The style I settled on was some sort of hybrid between a newspaper, research paper, and this [[anchor(EnM)]]{book} on [[note(left, orient:horizontal)]]{[[cite(https://www.goodreads.com/book/show/130417209-electromagnetic-theory-and-engineering-applications)]]{Electricity & Magnetism}}{[[jump(EnM)]]{Goodreads} link because I really can't find anything else of note about this book online} I found in a free books pile on the floor of my school's electrical engineering building. The presentation of the content felt effortlessly finished.  The book was simple in a way that felt like it was being disciplined. Spare because it knew what it was doing, not because there was nothing to be said. Elegant illustrations and derivations, no fluff.
[[bigbreak]]
## Design & Features
[[tab]] From the start, I wanted the site to look like my scattered desk, a bunch of disjoint pages rather than a orderly manuscript.  I'd always intended to write about a mix of topics, and the scattered pages felt like just the right medium for that.  The Freya Holmér tweet isn't commenting on the design of websites, its about the physical remains of creative work, but it struck a chord with me regardless.
[[break]]
[[tab]] One thing I have realized over the course of making this post: it is really hard to make a weird website that is also easy to read. Its hard to blend the wackiness of being able to rotate the canvas around or spawn a bunch of new pages with having writing thats just easy to read. If I wanted to write a blog post on something programming-related and post it to something like HackerNews, most people would click out before they started reading  So while this started as just having cards and that being the only option, it slowly evolved to be more "normal".  Testing the reading experience on my phone throughout the development impacted a lot of the design decisions.

[[break]]
### Controls
[[tab]] To get a sense of how to navigate the website, it might be useful to  [[toggle(bind: showHandles, on: true, off: false, label: turn on card handles, inline: true)]]. This will show you where to click to rotate, scale, or move a page. You can also do the same transformations to the entire canvas, click and drag to pan, right click and drag to rotate, and scroll to zoom in and out.  You can also toggle between light and [[toggle(bind: theme, on: dark, off: light, label: dark mode, inline: true)]] to match your desired reading experience.  Settings persist session-to-session, and to make reading easier you can always adjust the [[slider(bind: fontSize, min: 12, max: 22, step: 1, label: font size, suffix: px, inline: true)]] or the  [[slider(bind: marginSize, min: 0, max: 45, step: 1, label: margin width, suffix: %, inline: true)]]   The goal is for everything to be readable, whatever device you're on.  There are more settings in the bottom left, explore them as the canvas fills up. 

[[break]]
### Reader Mode
[[tab]]Reader mode strips out the idiosyncrasies, no rotating pages or popups, it's for when I want a post to just be readable. If I want a post to reach a broad audience, then I unfortunately can't expect them to all be dragging pages around and expanding out pop ups or turning their phone ninety degrees to read about accelerator programming.  Reader mode came with more implications. If a page is built for reader mode first,  I have to pull back on the usage of card links. I'll allow anything I feel is really worth a detour, but I can't treat every tangent as an opportunity. 
[[break]]
[[tab]] There's probably no clean solution. I just have to consider what posts are meant to be reader mode first, and what posts can take full advantage of everything. Most posts will probably be reader-mode first, but I'm occasionally there'll be a post that only makes sense as scattered pages - the way House of Leaves only makes sense as a physical book.

[[break]]
### Margins
[[tab]] The margins are by far my favorite feature on this website. They add a sketchiness to it that feels very conducive to the way I think.  Text can go in any of the four [[note(top, orient:horizontal)]]{margins}{[[anchor(topMarginText)]]{Not always easy to see this when scrolling by!}}, in any [[note(right, orient:vertical)]]{orientation}{How much I anticipate writing vertically I really don't know, but it'll have its uses down the line}. Margins can either be relative or absolute; relative margins will track a word or block of code while absolute margins will always appear in the same position regardless of orientation. [[note(left, orient:horizontal)]]{Overall}{Though, sometimes it's necessary to create a jump to point out when a margin corresponds to something. Like [[jump(topMarginText)]]{this.}}, I like them as a way to think out loud. Whever the main text goes, the margin reflects everything else on my mind.  
[[break]]
[[tab]] Margins were also created as a first-class citizen. Anything that can be displayed in the main body text must also work in the margin, in any orientation. This includes LaTeX math, buttons, interactive visualizations, etc.  I wanted to be able to put anything anywhere.  It's one of those things that will likely have a bad effort-reward ratio, but the cases where it's just the right tool to express whats in my mind feel worth all of it.

[[break]]
### Domain-Specific Features
[[tab]] Because of the nature of the writing I plan to do, there are a lot of features that are made to accommodate technical writing. For example,  inline math like $\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}$ was non-negotiable. Or what if I need a defining theorum?

$$L_o(x, \omega_o) = L_e(x, \omega_o) + \int_{\Omega} f_r(x, \omega_i, \omega_o) L_i(x, \omega_i) (\mathbf{n} \cdot \omega_i) d\omega_i$$
[[tab]]I also wanted to be able to include interactive visualizations on the page. These might be simple plots:
[[viz(type: polynomial, a3: 0.05, a2: -0.5, a1: 0, a0: 2, height: 250)]]
[[tab]] Or full on 3D graphs and models.
[[viz(type: nodegraph3d, nodes: "Hub,A,B,C,D,E", edges: "Hub-A,Hub-B,Hub-C,Hub-D,Hub-E,A-B,C-D", size: medium, align: center)]]
[[tab]]Code is also an obvious must.
[[code(cpp)]]
{
template <typename T, std::enable_if_t<std::is_arithmetic_v<T>, int> = 0>
[[nodiscard]] constexpr auto syntax_stress(const T* ptr) noexcept -> decltype(*ptr + 1.0) {
    /* Block comment */ const char* raw_str = R"delim(Raw "string" \n)delim";
    auto lambda = [hex_val = 0x2A](T& ref) mutable -> double { return ref += hex_val; };
    return ptr ? lambda(*const_cast<T*>(ptr)) : 3.14159f; // Ternary & float literal
}
} 

[[break]]
### Authoring
[[tab]]  To write new posts, I use a markdown-based DSL.  Tags follow the convention of C++ attributes (because I like it visually,  and it makes it very easy to parse/remember). E.g. to write some text in the margin I might say `[[margin(right, type: relative, orient: vertical)]]{this text goes in the margin}`. 
[[break]]
[[tab]] The DSL runs across the whole site, gluing the internals together.  It can call functions,  insert blocks of text and code into a card (like the table of conents, or the auto-generated tags at the top). They hide the ugly internals of the website and make the writing process clean. The goal: someone who has no idea how the website works could read the source for this post and start writing their own.

[[break]]
[[tab]] There is also a built-in editor that I have been using to write this post. I am not sure if I will stick with it over VSCode, considering this is all plain text, but it is nice being able to develop completely on the page and watching the margins update in realtime. It also reduces the mental overhead of remembering a new syntax,  the dropdown options at the top lay bare all of my options. The editor button only appears while developing locally, which can be seen in the image below.
[[image(images/weird/editor.png, scale: 100%, fit: cover, align: center)]]
{
}
[[break]]
### Tags
[[tab]]  The tag system went through a few iterations before I landed on something I was happy with, loosening each iteration.  At first I had a fixed list of tags I thought would be representative, but it got constraining fast.  The current system is similar, but there is no fixed list. For each card, I specify a list of [sub-tag, main-tag]. The website will then auto generate lists that display pages by main-tag, sorted by date.  It also generates cards for sub-tags, so a user can click on a sub-tag page and see every post that shares it.  This is still a work in progress, but ideally it makes posts both findeable and unconstrained.

[[bigbreak]]
## Claude
[[tab]] I did not write a single line of the code for this website, our metal buddy Claude wrote all of it. Claude, conversely, will not be writing any of the posts. I had the ideas for the design but no interest in learning web technologies from scratch. Having essentially no experience in developing for the web, I thought it would be a good opportunity to stress-test LLM programming 

[[break]]
### Claude.com
[[tab]] The first iteration of this page was created using the Claude website and a mix of Sonnet 3.5/4 and Opus 4, around May 2025.  At the time I had a pro subscription because Anthropic was running a '99¢ for 3-month' deal for students. Overall, I was disappointed by the experience. The code Claude generated quickly became unusable, it struggled to keep the internals of the (at the time) very short website in its context, and it failed to understand how I wanted features implemented. It particularly struggled with the margins, completely botching the implementation time after time until I gave up.  I also frequently hit the usage limits, it was always frustrating being in the zone and then being told to wait till 3AM to get more usage.

[[break]]
### Claude Code
[[tab]] A little over a year later in September, 2025, I gave Claude another attempt, but this time using Claude Code. It had been getting a lot of attention and this task seemed like a natural fit.  Claude could start from scratch, and the code is naturally small and self-contained. My experience this time was radically different than the previous year's attempt.Claude Code's ability to pull sections of code into its context along with improved models made the development experience incomparably better. I would never have been able to build this quickly before, especially not with a bunch of technologies I'd never touched before. Improvements in models continue to bolster my faith in Claude. The bones of this website were written with Claude Opus 4,  with more recent additions being Opus 4.5 or 4.6.
[[break]]
[[tab]] There are still obviously glaring issues with Claude Code. The code it generates is often unmaintainable, even for itself. It will frequently get lost or define the same constant in a handful of places and update a portion of them while forgetting the rest. It can also be difficult to express some design ideas to it, though that has not been a major hurdle in my experience. Despite this, I'm happy with how the experiment has gone, at least as long as an LLM is going to be the one that has to maintain it. If you're interested in seeing the code that Claude generated, it is on my GitHub [[cite(https://github.com/Ish-D/Ish-D.github.io)]]{here}.