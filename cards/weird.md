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
[[toc]]
---
## Purpose
[[drop(I)]] have spent a lot of the past few years telling myself that I should start writing more. I think it is a fairly common sentiment that writing is one of the best (or only?) ways to explore an idea fully; it forces you to consolidate the ideas scattered around your head and face your preconceived notions around them. I remember reading a Paul Graham quote a few years ago that said something along the lines of "The fact that you get a nice block of text to share after writing an essay is just an additional benefit; the main value in writing is that you have to organize your thoughts while writing". I'm paraphrasing because I don't care to search Twitter for the source at the time of writing this, but you get the idea. My main goal in making this site is to have a formal continuation of a series of one-page essays I wrote around late 2023 as a means to explore some of my own thoughts on some random topics. These ranged from thinking about why I dislike the idea of rewatching/rereading things (& my own related rituals) to personal retrospectives to a fake eulogy for my friend. I'm not sure if I'll ever get around to putting those up, but I think that sets the tone for what to expect from maybe ~a third of the posts I have in mind (i.e., rambling).
[[break]]
[[tab]] I want the next third to be more technical, focused on software engineering, GPUs, graphics, etc. These are topics I love and frequently have many thoughts about; this page was created as an outlet for them as much as my aforementioned unsolicited opinions on random topics. There are a lot of projects I want to make, and lots of topics to learn about! The list only gets longer, and I am sad that I only get to tackle a few at a time. I try to be working on 2-3 things to rotate between at any given time, to not get too bored with any single project, and let ideas from the others marinate in the meantime. A lot of these are also really meant to be a means for me to learn things; for example, I want to learn more about the internals of LLMs and their training/inference process (for both personal interest and career development reasons). My goal is to write a state-of-the-art local inference engine for some popular small model like Quen-3.5-35b (though the "hot" local LLM at the moment feels like it changes day-to-day, so who knows what it'll be by the time I actually get to it) for MacOS using the new tensor cores on the iPhone 17/M5 line of products.  
[[break]]
[[tab]] The last third is really just the "everything else". There are a lot of miscellaneous topics I often want to share short blurbs about that I feel I never get to; quotes from books, movie reviews, art, photography, etc., etc., etc. I wear my heart on my sleeve with the things I love, and I feel like there's just so much to be said and shared about everything. 
[[quote([[cite(https://gwern.net/about#the-content)]]{Gwern Branwen})]]
{
I believe that someone who has been well-educated will think of something worth writing at least once a week; to a surprising extent, this has been true.
}
[[tab]]In my time creating this site, I've found the above Gwern quote incredibly true. There's just so much going through everyone's head all the time; at least some of those thoughts are bound to be worth exploring and expanding on. When your brain begins framing these random ideas as 'potential ideas to write about' more than 'superfluous nonsense,' all of a sudden, you're much more inclined to think about them. 
[[break]]
[[tab]] I think if you look at this site, it's also not really much of a surprise that I like the whole thing Gwern has going on. His website feels loose and informal, but with rationale and experiments to back up his writing. There's a whole category of report-leaning writing that includes his experiments and other blogs like this one on the [[cite(https://investment.binhph.am/#/analysis/ai-inference)]]{low of capital through the AI inference supply chain} or this one on [[cite(https://ciechanow.ski/cameras-and-lenses/)]]{the mechanics behind cameras and lenses} that are endlessly fascinating to me. They are extremely high-effort, are often interactive, and are not necessarily directly programming-related but fall at the intersection of many fields. I can only imagine the amount of effort that goes into them, but my goal is to eventually write things that are similarly useful to somebody. 
[[bigbreak]]

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

[[tab]]I've been a big fan of various blogs for a long time and have learned a lot of things from them, so naturally, I wanted my own space to share with the world. Around December 2024, I started collecting references for the overall vibe I wanted to convey. The references were kind of all over the place, the type of thing that could only really be coherent to the person who gathered them; I had tweets, blog posts, pictures from [[note(right, orient:horizontal)]]{[[anchor(house-of-leaves)]]{novels}}{I think the [[cite(https://en.wikipedia.org/wiki/House_of_Leaves)]]{House of Leaves} [[jump(house-of-leaves)]]{ influence} here will be pretty apparent. Though I really wonder how much I'll actually end up making use of the whole story-in-a-margin thing.} and [[jump(EnM)]]{textbooks}, random notes, kind of everything in the media spectrum. The quote above was a particularly central one to the design brainstorming. I really latched onto the idea that my website could have this unique physical feel to it; it could be messy or disorganized, but it felt natural. I'm a heavy user of parentheses in my writing and tend to go on tangents in conversation, so why not extend that with the House of Leaves style story-in-a-story-in-a-margin? The atomic unit of my website being these individual cards makes it easy to interject long tangentially related blocks in the middle of otherwise coherent writing. Where on a regular website you may depth-first search (open any interesting links in a new tab, visit them after you have finished reading the main article), I want to encourage exploring breadth-first (as you come across a new card, give it a read and then return to the original subject. Obviously, I can't quite force this on a reader, but something about it feels intuitive to me.
[[break]]

[[tab]] I've already mentioned Gwern here, but one of the primary inspirations for me was always [[cite(https://thenumb.at/)]]{Max Slater}. His posts are often on the shorter side but incredibly informative, filled with interactive visuals. The visualizations in his and Bartosz Ciechanowski's posts always felt like they helped bridge any gaps and get to the next level of understanding. Thus, it became a requirement that I needed to be able to easily embed graphics, functions, graphs, etc., into whatever I was writing. 
[[break]]
[[tab]] At the same time, there is a simplicity of good old print media that's really pleasing to the eye.  Who doesn't like the look of a physical newspaper? The style I settled on was some sort of hybrid between a newspaper, research paper, and this [[anchor(EnM)]]{book} on [[note(left, orient:horizontal)]]{[[cite(https://www.goodreads.com/book/show/130417209-electromagnetic-theory-and-engineering-applications)]]{Electricity & Magnetism}}{ [[tab]] [[jump(EnM)]]{Goodreads} link because I really can't find anything else of note about this book online} I found in a free books pile on the floor of my school's electrical engineering building. Something about the simplicity in the presentation felt so incredibly refined to me. The book had really nicely drawn illustrations and elegant derivations that easily made the contents of each chapter suddenly so intuitive.

[[bigbreak]]
## Design & Features

[[bigbreak]]
## Claude

[[bigbreak]]
## Placeholder

