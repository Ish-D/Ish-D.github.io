---
name: Why Make a Page This Weird?
width: 320
height: 400
progressBar: true
wordCount: true
readTime: true
tags: [essays, ideas], [personal, meta], [design, meta]
date: 01-30-2026
---

# Advanced Optimization of 3D Gaussian Splatting Pipelines
[[tags]]
[[date]]    

[[toc]]
---
## Architectural Analysis of High-Performance Rendering on Apple Silicon
[[margin(right, type: relative, orient: horizontal)]]
{
[[anchor(3DGS-Paper)]]{Original Gaussian Splatting Paper by Inria}
}
[[drop(T)]]he optimization of 3D Gaussian Splatting ([[jump(3DGS-Paper)]]{3DGS}) pipelines on Apple Silicon architectures requires a fundamental departure from the optimization strategies employed for discrete, immediate-mode GPUs (such as those from NVIDIA or AMD). The performance profile described—wherein the vertex shader constitutes the primary bottleneck, followed closely by the fragment shader, while compute and sorting passes remain highly efficient—presents a specific pathological case. This profile suggests that the rendering pipeline is heavily saturated by the fixed-function geometry units and the memory bandwidth requirements of alpha blending, while the massive parallel compute throughput of the M-series GPU remains underutilized.

$$
x = \sum\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$


### The Vertex Shader Bottleneck: Input Assembly and Expansion

[[margin(left, type: relative, orient: horizontal)]]
{
Assumes knowledge of the traditional hardware rasterization pipeline.
}


In a traditional hardware-rasterized 3DGS implementation, each Gaussian is treated as a point primitive that must be expanded into a quad (billboard) to cover its 2D extent. If implemented via standard vertex shaders using instancing (drawing 4 vertices per Gaussian instance), the GPU's Input Assembler (IA) is forced to fetch index and vertex data for four times the number of actual Gaussians. For a scene with 4 million visible Gaussians, the IA processes 16 million vertices.

## Geometric Optimization: Transitioning to Metal Mesh Shaders
The most effective method to resolve a vertex shader bottleneck in a high-primitive-count pipeline on modern Apple hardware is to bypass the traditional vertex pipeline entirely and adopt Metal Mesh Shaders. Introduced in Metal 3 and supported on A13/M1 and later chips, mesh shaders provide a compute-centric approach to geometry processing that aligns perfectly with the "fast compute" characteristic of the current workload.

### The Inefficiency of the Vertex Pulling Model
The current vertex shader implementation likely employs "vertex pulling" or instanced drawing. In this model, the rasterizer dictates the workload: it requests vertices, and the shader provides them. This model is rigid. It is difficult to cull an entire splat efficiently within the vertex shader without emitting degenerate triangles (which still consume rasterizer cycles). Furthermore, it requires redundant memory fetches for the Gaussian attributes (position, rotation, scale, opacity, SH coefficients) across the four vertices of the quad.

### Architecture of the Metal Mesh Pipeline
The Metal Mesh Shader pipeline consists of two programmable stages that replace the Vertex Shader: the Object Shader and the Mesh Shader. This architecture allows for a two-phase culling and expansion process that is vastly superior for particle-based rendering like 3DGS.

## Algorithmic Minimization: SnugBox and AccuTile Implementation
