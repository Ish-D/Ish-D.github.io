---
name: LLM Inference for Bozos, Part 1
width: 400
height: 400
progressBar: true
wordCount: true
readTime: true
tags: [LLMs, technical], [C++, technical],[projects, meta]
date: 04-14-2026
---

# LLM Inference for Bozos, Part 1

[[tags]]
[[date]]    
[[summary]]{First post in a series where I explore the process of writing a high-performance LLM inference engine from scratch. This post will go over the fundamental theory behind LLMs and write some surprisingly simple code to infer Llama 3 1B.}
[[toc]]
---
## Prologue
[[drop(L)]]arge language models (LLMs) have very quickly become a part of every day life for many people. When I started at my current job at the beginning of August, my company had just begin some internal AI initiatives like giving everyone a daily claude code budget and providing an internal chat interface to talk to various approved LLMs.As time went on, it was apparent how AI (largely Claude) was becoming an irreplaceable part of everyones routine. 
[[break]]
[[tab]] The more I talk to friends and family across various industries the more everyone talks about pre-AI work as some sort of archaic period. These tools truly have completely changed the way many of us work; whether it be design oriented generative AI like Photoshop's [[cite(https://helpx.adobe.com/photoshop/desktop/repair-retouch/remove-objects-fill-space/blend-subjects-with-harmonize.html)]]{harmonize} tool and [[cite(https://research.adobe.com/news/new-photoshop-feature-rotate-2d-objects-in-three-dimensions/)]]{2D -> 3D rotation feature}, any number of programming related tools[[cite(https://code.claude.com/docs/en/overview)]][[cite(https://openai.com/codex/)]][[cite(https://cursor.com/)]], or the increasingly popular [[cite(https://openclaw.ai/)]]{LLM-as-your-personal-assistant}.

[[bigbreak]]
### The Road Ahead
[[tab]] This series of posts is going to focus on writing a state of the art LLM inference engine from scratch. This post is going to go into the core theory behind LLMs. I am working with the assumption that you are proficient enough with general computer science/programming principles and also have some high-school level math background, but have little to no knowedge about the internals of modern LLMs. I want to note that this post is dedicated to *inference*,  I will go over some training details as they are relevant to the overall architecture, but training and theory is not the general focus of this post.
[[break]]
[[tab]] This first post is going to go into the fundamental theory behind LLMs, starting with basic neural networks and working our way towards a simplermodel like Llama 3.2 1B. Future posts will go into a more modern model like the recently-released Gemma 4 family. All of the initial code is in plain C++ with minimal dependencies for clarity. After that, I'll begin porting everything to the GPU in Metal shading language, aiming to match or beat the performance of popular open source implementations like llama.cpp or MLX.
[[bigbreak]]
### Local LLMs
[[tab]] An important part of all of this for me is that I can run everything we write on my own laptop. Oftentimes in similar types of writeups people will write all of their kernels on rented server GPUs which makes sense in the context of preparing for jobs writing kernels at large companies.  But apart from not wanting to spend money on renting compute, I've recently become increasingly interested in the capabilities of local LLMs.  
[[break]]
[[tab]]For the unfamiliar on the topic, there are two main ways you can use LLMs. The overwhelming majority of people will interact with them through some web interface like ChatGPT, Claude, or Gemini. In these cases, the model's weights are sitting in memory in a datacenter filled with server-grade GPUs like B200s. Every prompt you send over gets sent over to a server that will process your and other users' requests, do all the necessary computation, and spit the result back out. This means that the model's weights  [[note(right, type: relative, orient: horizontal)]]{}{We'll go over what weights mean in the context of machine learning soon, but the easiest way to think about it is they are the coefficients in all of the math that the model is doing to  produce an output.} live on the server and your computer has no knowledge of any of the computation thats being done. Oftentimes for large popular models like Claude, the weights are likely much too large to be useable on any local computer anyways.
[[break]]
[[tab]] The alternative to this is running a model locally. This means that you download the weights of an existing open-source model like [[cite(https://huggingface.co/meta-llama/Llama-3.2-1B)]]{LLama 3.2 1B} and have your computer do all of the work to generate the outputs. This comes with a few major downsides; you are limited to using whatever models have their weights available online (which are generally less capable than the household names) and you need a computer powerful enough to run that model on.  [[note(left, orient: horizontal)]]{}{A very important element if you're worried about rate limits, model performance degrading, or for whatever reason [[cite(https://www.reddit.com/r/MyBoyfriendIsAI/)]]{emotionally attached to your model}} The upsides are that you get to use these models for free and don't have to worry about your model changing or becoming unavailable 
[[break]]

[[bigbreak]]
## Neural Networks
[[tab]] The foundation of mostly all modern machine learning is the neural network. 

[[bigbreak]]
##  Transformers

[[bigbreak]]
## Epilogue
